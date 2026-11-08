import { describe, expect, it, vi } from 'vitest'
import type { SSHConnectionConfig } from '../SSHService'
import { checkUserLogin } from './userLogin'

const config = { host: 'example.test', port: 2222, username: 'admin', authMethod: 'publickey', privateKeyPath: '/keys/id' } as SSHConnectionConfig

function fakeLogin() {
  const run = vi.fn().mockResolvedValue('ok')
  const login = vi.fn(() => ({ run }))
  return { login, run }
}

describe('checkUserLogin', () => {
  it('logs in with the same key as the new user on the session port', async () => {
    const { login, run } = fakeLogin()
    await checkUserLogin(config, 'deploy', login)
    expect(login).toHaveBeenCalledWith({ ...config, username: 'deploy' })
    expect(run).toHaveBeenCalledWith(2222)
  })

  it('refuses sessions that do not log in with a key', async () => {
    const { login } = fakeLogin()
    await expect(checkUserLogin({ ...config, authMethod: 'password' }, 'deploy', login)).rejects.toThrow('does not log in with an SSH key')
    expect(login).not.toHaveBeenCalled()
  })

  it('refuses bad user names and unsaved sessions', async () => {
    const { login } = fakeLogin()
    await expect(checkUserLogin(config, '', login)).rejects.toThrow('Choose a user')
    await expect(checkUserLogin(config, 'Root;x', login)).rejects.toThrow('Linux user name')
    await expect(checkUserLogin(null, 'deploy', login)).rejects.toThrow('Save the session first')
    expect(login).not.toHaveBeenCalled()
  })

  it('passes on a failed login', async () => {
    const { login, run } = fakeLogin()
    run.mockRejectedValue(new Error('All configured authentication methods failed'))
    await expect(checkUserLogin(config, 'deploy', login)).rejects.toThrow('authentication methods failed')
  })
})
