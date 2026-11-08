import { testIpcContext } from '../../../services/server/testing/ipcContext'
import { execFileSync } from 'node:child_process'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRemoteExec } from '../../../services/server/testing/FakeRemoteExec'
import type { ServerIpcContext } from '../../../services/server/context'

type Handler = (event: unknown, ...args: unknown[]) => Promise<{ success: boolean; error?: string; data?: unknown }>

const handlers = new Map<string, Handler>()
const showSaveDialog = vi.fn()
const download = vi.fn(async () => undefined)
const end = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) }
}))
vi.mock('../../ssh.ipc', () => ({ getSSHService: () => ({ get: () => ({ getSFTP: async () => ({ end }) }) }) }))
vi.mock('../../../services/SFTPService', () => ({ SFTPService: class { download = download } }))

const FILE = '/var/backups/shellway/db/mysql/shop_prod-20251107-030000.sql.gz'
const TEMP = '/home/deploy/.shellway-dl.Ab12Cd34'
let fake: FakeRemoteExec

beforeAll(async () => {
  const { registerDatabasesIPC } = await import('./databases')
  const ctx: ServerIpcContext = testIpcContext({ execFor: () => fake.exec, broadcast: vi.fn() })
  registerDatabasesIPC(ctx)
})

beforeEach(() => {
  fake = new FakeRemoteExec()
  showSaveDialog.mockReset()
  download.mockClear()
  end.mockClear()
})

const call = (...args: unknown[]) => handlers.get('server:databases:download')!({ sender: {} }, ...args)

describe('server:databases:download', () => {
  it('copies as root to a private temp file, downloads it and removes it', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/Users/me/shop.sql.gz' })
    fake.on('sudo -n sh -s', { stdout: `${TEMP}\n` })
    const result = await call('conn-1', FILE)
    expect(result).toEqual({ success: true, data: { savedTo: '/Users/me/shop.sql.gz' } })
    expect(fake.calls[0].stdin).toContain(`cp '${FILE}' "$t"`)
    expect(download).toHaveBeenCalledWith(TEMP, '/Users/me/shop.sql.gz', expect.any(String))
    expect(fake.calls[1].command).toBe(`rm -f '${TEMP}'`)
    expect(end).toHaveBeenCalled()
  })

  it('still removes the temp file when the download fails', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/Users/me/shop.sql.gz' })
    fake.on('sudo -n sh -s', { stdout: `${TEMP}\n` })
    download.mockRejectedValueOnce(new Error('connection lost'))
    expect(await call('conn-1', FILE)).toEqual({ success: false, error: 'connection lost' })
    expect(fake.calls[1].command).toBe(`rm -f '${TEMP}'`)
  })

  it('refuses paths outside the backup folder without touching the server', async () => {
    for (const path of ['/etc/shadow', '/var/backups/shellway/db/mysql/../../../../etc/x-20250101-000000.sql.gz', 42]) {
      expect((await call('conn-1', path)).success).toBe(false)
    }
    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(fake.calls).toEqual([])
  })

  it('does nothing when the save dialog is cancelled', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await call('conn-1', FILE)).toEqual({ success: true, data: null })
    expect(fake.calls).toEqual([])
  })

  it('rejects an unexpected temp path from the server', async () => {
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/Users/me/x' })
    fake.on('sudo -n sh -s', { stdout: '/etc/passwd\n' })
    expect((await call('conn-1', FILE)).success).toBe(false)
    expect(download).not.toHaveBeenCalled()
  })

  it('sends a valid sh script', async () => {
    const { copyForDownloadScript } = await import('./databases')
    expect(() => execFileSync('sh', ['-n'], { input: copyForDownloadScript(FILE) })).not.toThrow()
  })
})
