import { beforeEach, describe, expect, it } from 'vitest'
import { useTransferStore } from './transferStore'
import { summarizeTransfers, summaryPercent } from '@/utils/transferSummary'
import type { TrackedTransfer, TransferStatus } from '@/types/transfer'

function transfer(id: string, status: TransferStatus, transferredBytes = 0): TrackedTransfer {
  return {
    id,
    connectionId: 'c1',
    fileName: id,
    sourcePath: `/remote/${id}`,
    destinationPath: `/local/${id}`,
    direction: 'download',
    status,
    totalBytes: 100,
    transferredBytes,
    speed: status === 'active' ? 50 : 0,
    eta: 0
  }
}

function batch(): TrackedTransfer[] {
  const { transfers, batchIds } = useTransferStore.getState()
  return transfers.filter((t) => batchIds.has(t.id))
}

describe('transferStore batches', () => {
  beforeEach(() => {
    useTransferStore.setState({ transfers: [], scans: [], batchIds: new Set() })
  })

  it('groups transfers enqueued while others are still pending', () => {
    const { upsertTransfer } = useTransferStore.getState()
    upsertTransfer(transfer('a', 'active'))
    upsertTransfer(transfer('b', 'queued'))
    expect(batch().map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('starts a new batch once everything has finished', () => {
    const { upsertTransfer } = useTransferStore.getState()
    upsertTransfer(transfer('a', 'active'))
    upsertTransfer(transfer('a', 'completed', 100))
    upsertTransfer(transfer('b', 'queued'))
    expect(batch().map((t) => t.id)).toEqual(['b'])
  })

  it('keeps a folder scan and its files in one batch', () => {
    const { upsertTransfer, applyScan } = useTransferStore.getState()
    upsertTransfer(transfer('old', 'completed', 100))
    applyScan({ groupId: 'g', groupName: 'logs', direction: 'download', scanning: true })
    upsertTransfer(transfer('g-0', 'queued'))
    applyScan({ groupId: 'g', groupName: 'logs', direction: 'download', scanning: false })
    upsertTransfer(transfer('g-1', 'queued'))
    expect(batch().map((t) => t.id)).toEqual(['g-0', 'g-1'])
    expect(useTransferStore.getState().scans).toEqual([])
  })
})

describe('summarizeTransfers', () => {
  it('counts files and weights progress by bytes', () => {
    const summary = summarizeTransfers([
      transfer('a', 'completed', 100),
      transfer('b', 'active', 50),
      transfer('c', 'failed', 0)
    ])
    expect(summary).toMatchObject({ totalFiles: 3, doneFiles: 1, failedFiles: 1, speed: 50, isRunning: true })
    expect(summaryPercent(summary)).toBe(50)
  })

  it('does not count cancelled files as transferred', () => {
    const summary = summarizeTransfers([transfer('a', 'completed', 100), transfer('b', 'cancelled', 40)])
    expect(summary).toMatchObject({ doneFiles: 1, cancelledFiles: 1, isRunning: false })
  })
})
