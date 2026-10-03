import { EventEmitter } from 'events'
import { describe, expect, it } from 'vitest'
import { TransferQueue, type TransferItem } from './TransferQueue'
import type { SFTPService } from './SFTPService'

/** A transfer that only ends when the test finishes or aborts it. */
class StallingSFTP extends EventEmitter {
  started: string[] = []
  aborted: string[] = []
  private finishers = new Map<string, () => void>()

  finish(id: string): void {
    this.finishers.get(id)?.()
  }

  download(_src: string, _dest: string, id: string, _limit: number, _keep: boolean, signal?: AbortSignal) {
    this.started.push(id)
    return new Promise<void>((resolve, reject) => {
      this.finishers.set(id, resolve)
      signal?.addEventListener('abort', () => {
        this.aborted.push(id)
        reject(new Error('aborted'))
      })
    })
  }
}

function enqueueDownload(queue: TransferQueue, id: string): void {
  queue.enqueue({ id, fileName: id, sourcePath: `/r/${id}`, destinationPath: `/l/${id}`, direction: 'download', totalBytes: 10 })
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('TransferQueue cancellation', () => {
  it('aborts the running transfer and frees its slot for the next one', async () => {
    const sftp = new StallingSFTP()
    const queue = new TransferQueue(1)
    queue.setSFTPService(sftp as unknown as SFTPService)

    enqueueDownload(queue, 'a')
    enqueueDownload(queue, 'b')
    expect(sftp.started).toEqual(['a'])

    queue.cancel('a')
    await flush()

    expect(sftp.aborted).toEqual(['a'])
    expect(sftp.started).toEqual(['a', 'b'])
    expect(queue.getTransferState('a')?.status).toBe('cancelled')
  })

  it('pausing stops the transfer and resuming restarts it', async () => {
    const sftp = new StallingSFTP()
    const queue = new TransferQueue(1)
    queue.setSFTPService(sftp as unknown as SFTPService)

    enqueueDownload(queue, 'a')
    queue.pause('a')
    queue.resume('a')
    await flush()

    expect(sftp.aborted).toEqual(['a'])
    expect(sftp.started).toEqual(['a', 'a'])
    expect((queue.getTransferState('a') as TransferItem).status).toBe('active')
  })

  it('reports one drained summary for a whole batch', async () => {
    const sftp = new StallingSFTP()
    const queue = new TransferQueue(2)
    queue.setSFTPService(sftp as unknown as SFTPService)
    const drained: unknown[] = []
    queue.on('drained', (summary) => drained.push(summary))

    enqueueDownload(queue, 'a')
    enqueueDownload(queue, 'b')
    sftp.finish('a')
    await flush()
    expect(drained).toEqual([])

    sftp.finish('b')
    await flush()
    expect(drained).toEqual([{ completed: ['a', 'b'], failed: [] }])
  })

  it('waits for an open folder scan before reporting the batch', async () => {
    const sftp = new StallingSFTP()
    const queue = new TransferQueue(2)
    queue.setSFTPService(sftp as unknown as SFTPService)
    const drained: unknown[] = []
    queue.on('drained', (summary) => drained.push(summary))
    const group = { groupId: 'g', groupName: 'folder', direction: 'download' as const }

    queue.announceScan({ ...group, scanning: true })
    enqueueDownload(queue, 'a')
    sftp.finish('a')
    await flush()
    expect(drained).toEqual([])

    enqueueDownload(queue, 'b')
    queue.announceScan({ ...group, scanning: false })
    sftp.finish('b')
    await flush()
    expect(drained).toEqual([{ completed: ['a', 'b'], failed: [] }])
  })

  it('treats a paused transfer as unfinished', async () => {
    const sftp = new StallingSFTP()
    const queue = new TransferQueue(2)
    queue.setSFTPService(sftp as unknown as SFTPService)
    const drained: unknown[] = []
    queue.on('drained', (summary) => drained.push(summary))

    enqueueDownload(queue, 'a')
    enqueueDownload(queue, 'b')
    sftp.finish('a')
    queue.pause('b')
    await flush()
    expect(drained).toEqual([])

    queue.cancelAll()
    await flush()
    expect(drained).toEqual([{ completed: ['a'], failed: [] }])
  })

  it('cancel all stops a folder that is still being enqueued', () => {
    const queue = new TransferQueue(2)
    const group = { groupId: 'g', groupName: 'folder', direction: 'download' as const }

    queue.announceScan({ ...group, scanning: true })
    queue.cancelAll()
    expect(queue.isScanCancelled('g')).toBe(true)

    queue.announceScan({ ...group, scanning: false })
    expect(queue.isScanCancelled('g')).toBe(false)
  })
})
