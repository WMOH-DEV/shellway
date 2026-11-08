import { describe, expect, it, vi } from 'vitest'
import type { SFTPWrapper } from 'ssh2'
import { SFTPService } from './SFTPService'

function serviceWith(destinationExists: boolean) {
  const service = new SFTPService({} as SFTPWrapper)
  vi.spyOn(service, 'readBytes').mockResolvedValue(Buffer.from('data'))
  vi.spyOn(service, 'pathExists').mockResolvedValue(destinationExists)
  vi.spyOn(service, 'writeBytes').mockRejectedValue(new Error('Permission denied'))
  const unlink = vi.spyOn(service, 'unlink').mockResolvedValue()
  return { service, unlink }
}

describe('SFTPService.copyFile', () => {
  it('removes the half-written copy when it created the destination', async () => {
    const { service, unlink } = serviceWith(false)
    await expect(service.copyFile('/src/a.png', '/dst/a.png')).rejects.toThrow('Permission denied')
    expect(unlink).toHaveBeenCalledWith('/dst/a.png')
  })

  it('never deletes a file that was already at the destination', async () => {
    const { service, unlink } = serviceWith(true)
    await expect(service.copyFile('/src/a.png', '/dst/a.png')).rejects.toThrow('Permission denied')
    expect(unlink).not.toHaveBeenCalled()
  })
})

describe('SFTPService.pathExists', () => {
  it('counts a broken symlink as existing', async () => {
    const lstat = vi.fn((_path: string, done: (err: Error | undefined) => void) => done(undefined))
    const service = new SFTPService({ lstat } as unknown as SFTPWrapper)
    await expect(service.pathExists('/dst/link')).resolves.toBe(true)
    expect(lstat).toHaveBeenCalledWith('/dst/link', expect.any(Function))
  })

  it('reports a missing path', async () => {
    const service = new SFTPService({ lstat: (_path: string, done: (err: Error) => void) => done(new Error('No such file')) } as unknown as SFTPWrapper)
    await expect(service.pathExists('/dst/none')).resolves.toBe(false)
  })
})
