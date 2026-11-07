import { describe, expect, it, vi } from 'vitest'
import type { SFTPWrapper } from 'ssh2'
import { SFTPService } from './SFTPService'

function serviceWith(destinationExists: boolean) {
  const service = new SFTPService({} as SFTPWrapper)
  vi.spyOn(service, 'readBytes').mockResolvedValue(Buffer.from('data'))
  vi.spyOn(service, 'stat').mockImplementation(async () => {
    if (!destinationExists) throw new Error('No such file')
    return {} as Awaited<ReturnType<SFTPService['stat']>>
  })
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
