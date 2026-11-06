import { beforeAll, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<{ success: boolean; error?: string; data?: unknown }>>()
const zonePreflight = vi.fn(async () => ({ zone: 'example.com' }))
const zoneSetMode = vi.fn(async () => ({ zone: 'example.com' }))

vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) } }))
vi.mock('../../ipc/ssh.ipc', () => ({ getSSHService: vi.fn() }))
vi.mock('../WindowManager', () => ({ broadcast: vi.fn() }))
vi.mock('../NotificationService', () => ({ getNotificationService: vi.fn() }))
vi.mock('../../utils/sshExec', () => ({ sshExec: vi.fn() }))
vi.mock('./SslLocalStore', () => ({ SslLocalStore: class {} }))
vi.mock('./AlertProbe', () => ({ AlertProbe: class { start() {} }, tlsProbe: vi.fn() }))
vi.mock('./SslCoordinator', () => ({ SslCoordinator: class { zonePreflight = zonePreflight; zoneSetMode = zoneSetMode } }))

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)

beforeAll(async () => {
  const { registerSslIPC } = await import('../../ipc/ssl.ipc')
  registerSslIPC()
})

describe('ssl zone channels', () => {
  it('passes a valid preflight request through', async () => {
    expect(await call('ssl:zone-preflight', 'example.com')).toEqual({ success: true, data: { zone: 'example.com' } })
    expect(zonePreflight).toHaveBeenCalledWith('example.com')
  })

  it('rejects a missing zone', async () => {
    expect(await call('ssl:zone-preflight', '')).toEqual({ success: false, error: 'Invalid zone' })
  })

  it.each(['origin_pull', 'bogus', 42, undefined])('rejects the mode %s before reaching the coordinator', async (mode) => {
    zoneSetMode.mockClear()
    expect(await call('ssl:zone-set-mode', 'example.com', mode, [])).toEqual({ success: false, error: 'Invalid SSL mode' })
    expect(zoneSetMode).not.toHaveBeenCalled()
  })

  it('rejects a confirmation list that is not a list of names', async () => {
    zoneSetMode.mockClear()
    expect((await call('ssl:zone-set-mode', 'example.com', 'strict', 'app.example.com')).success).toBe(false)
    expect((await call('ssl:zone-set-mode', 'example.com', 'strict', [1])).success).toBe(false)
    expect(zoneSetMode).not.toHaveBeenCalled()
  })

  it('passes a valid change through', async () => {
    await call('ssl:zone-set-mode', 'example.com', 'strict', ['app.example.com'])
    expect(zoneSetMode).toHaveBeenCalledWith('example.com', 'strict', ['app.example.com'])
  })
})
