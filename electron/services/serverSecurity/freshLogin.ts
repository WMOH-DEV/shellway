import { randomUUID } from 'crypto'
import { SSHConnection, type SSHConnectionConfig } from '../SSHService'
import { sshExec } from '../../utils/sshExec'
import { VERIFY_COMMAND } from '../../../src/utils/server/security/guard'
import type { FreshLogin } from './LockoutGuard'

const LOGIN_TIMEOUT_MS = 20_000
const COMMAND_TIMEOUT_MS = 10_000
const PROMPT_FREE_METHODS: ReadonlyArray<SSHConnectionConfig['authMethod']> = ['password', 'publickey', 'publickey+passphrase', 'publickey+password', 'agent']

export function promptFreeLogin(config: SSHConnectionConfig): boolean {
  if (PROMPT_FREE_METHODS.includes(config.authMethod)) return true
  return config.authMethod === 'keyboard-interactive' && config.kbdiAutoRespond === true && (Boolean(config.password) || Object.keys(config.kbdiSavedResponses ?? {}).length > 0)
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function loginOnce(config: SSHConnectionConfig, port: number): Promise<string> {
  const conn = new SSHConnection(`shellway-verify-${randomUUID()}`, { ...config, port, reconnection: undefined, readyTimeout: Math.min(config.readyTimeout ?? 15, 15) })
  conn.on('kbdi-prompt', (_id: string, _prompt: unknown, respond: (responses: string[]) => void) => respond([]))
  try {
    await withTimeout(conn.connect(), LOGIN_TIMEOUT_MS, `No login on port ${port} within ${LOGIN_TIMEOUT_MS / 1000} s`)
    const result = await sshExec(conn, VERIFY_COMMAND, { timeoutMs: COMMAND_TIMEOUT_MS })
    if (result.code !== 0) throw new Error(`Logged in, but a simple command failed (exit ${result.code})`)
    return result.stdout
  } finally {
    conn.destroy()
  }
}

export function freshLogin(config: SSHConnectionConfig): FreshLogin {
  return { run: (port) => loginOnce(config, port) }
}
