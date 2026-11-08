import type { RemoteExec } from '../deploy/DeployService'

export const TIMEOUT_EXITS: ReadonlySet<number> = new Set([124, 137])

const SUDO_FAILURE = /sudo: (?:a password is required|a terminal is required|sorry, you must have a tty)|sudo: .*(?:is not in the sudoers|is not allowed to|may not run sudo)|sudo: (?:command )?not found/i
const STATE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED_KEYS: ReadonlySet<string> = new Set(['PATH', 'IFS', 'ENV', 'BASH_ENV', 'HOME', 'SHELL', 'PS4', 'SHELLWAY_RUN_ID'])

export class Disconnected extends Error {
  constructor() {
    super('The connection to the server dropped')
  }
}

export const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`

export const limitedShell = (root: boolean, seconds: number, killAfter: number): string =>
  `${root ? 'sudo -n ' : ''}timeout -k ${killAfter} ${seconds} sh -s`

export const stdinSafe = (script: string): string => `{\n${script.trimEnd()}\n} </dev/null\n`

export const isSudoFailure = (output: string): boolean => SUDO_FAILURE.test(output)

export const isStateKey = (key: string): boolean => STATE_KEY.test(key) && !RESERVED_KEYS.has(key) && !key.startsWith('LD_')

export function stepInput(runId: string, script: string, state: Record<string, string> = {}): string {
  const exports = Object.entries(state).filter(([key]) => isStateKey(key)).map(([key, value]) => `export ${key}=${quote(value)}`)
  return [`export SHELLWAY_RUN_ID=${quote(runId)}`, ...exports, stdinSafe(script)].join('\n')
}

export const lastLine = (text: string): string => text.split('\n').map((line) => line.trim()).filter(Boolean).pop() ?? ''

export interface RemoteDeps {
  execFor(connectionId: string): RemoteExec | null
  sleep(ms: number): Promise<void>
}

const CLOSE_GRACE_MS = 1000

export function remoteFor(deps: RemoteDeps, connectionId: () => string): RemoteExec {
  const connected = () => deps.execFor(connectionId()) !== null
  return async (command, options) => {
    const exec = deps.execFor(connectionId())
    if (!exec) throw new Disconnected()
    try {
      const result = await exec(command, options)
      if (typeof result.code === 'number') return result
      await deps.sleep(CLOSE_GRACE_MS)
      if (!connected()) throw new Disconnected()
      return { ...result, code: -1 }
    } catch (err) {
      if (err instanceof Disconnected || !connected()) throw new Disconnected()
      throw err
    }
  }
}
