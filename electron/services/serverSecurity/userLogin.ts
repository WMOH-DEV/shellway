import { deployUserError } from '../../../src/utils/server/settings/prefs'
import type { SSHConnectionConfig } from '../SSHService'
import { freshLogin } from './freshLogin'

const KEY_METHODS: ReadonlyArray<SSHConnectionConfig['authMethod']> = ['publickey', 'publickey+passphrase', 'agent']

export async function checkUserLogin(config: SSHConnectionConfig | null, user: string, login = freshLogin): Promise<void> {
  const problem = user ? deployUserError(user) : 'Choose a user to log in as'
  if (problem) throw new Error(problem)
  if (!config) throw new Error('Shellway cannot open a second connection for this session. Save the session first, then reconnect.')
  if (!KEY_METHODS.includes(config.authMethod)) throw new Error(`This session does not log in with an SSH key, so Shellway cannot check a login as ${user}.`)
  await login({ ...config, username: user }).run(config.port)
}
