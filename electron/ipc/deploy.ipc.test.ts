import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type Reply = { success: boolean; error?: string; data?: unknown }
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<Reply>>()
const setGithubToken = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) }
}))
vi.mock('./ssh.ipc', () => ({ getSSHService: vi.fn() }))
vi.mock('./server.ipc', () => ({ withServerActivity: (fn: unknown) => fn }))
vi.mock('../services/WindowManager', () => ({ broadcast: vi.fn() }))
vi.mock('../services/NotificationService', () => ({ getNotificationService: vi.fn() }))
vi.mock('../services/serverNotify/notifyEvents', () => ({ withServerNotify: (fn: unknown) => fn }))
vi.mock('../utils/sshExec', () => ({ sshExec: vi.fn() }))
vi.mock('../services/deploy/LocalGit', () => ({ LocalGit: class {} }))
vi.mock('../services/deploy/DeployLocalStore', () => ({ DeployLocalStore: class { setGithubToken = setGithubToken } }))
vi.mock('../services/deploy/DeployCoordinator', () => ({ DeployCoordinator: class { startWatching() {} } }))

const save = (token: unknown) => handlers.get('deploy:github-token-save')!({}, token)

beforeAll(async () => {
  const { registerDeployIPC } = await import('./deploy.ipc')
  registerDeployIPC()
})

beforeEach(() => setGithubToken.mockClear())

describe('deploy:github-token-save', () => {
  it.each([[''], ['   '], [42], [undefined], ['ghp_abc def'], ['ghp-abc'], ['a'.repeat(256)]])('rejects %j without saving', async (token) => {
    const reply = await save(token)
    expect(reply.success).toBe(false)
    expect(setGithubToken).not.toHaveBeenCalled()
  })

  it('never echoes the token in an error', async () => {
    const reply = await save('ghp_bad token')
    expect(reply.error).not.toContain('ghp_bad')
  })

  it('saves a trimmed classic token', async () => {
    expect(await save('  ghp_Abc123_x  ')).toEqual({ success: true, data: undefined })
    expect(setGithubToken).toHaveBeenCalledWith('ghp_Abc123_x')
  })

  it('saves a fine-grained token', async () => {
    const token = `github_pat_${'A1b2'.repeat(20)}`
    expect((await save(token)).success).toBe(true)
    expect(setGithubToken).toHaveBeenCalledWith(token)
  })
})
