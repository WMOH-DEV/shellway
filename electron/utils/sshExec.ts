import type { Readable } from 'stream'
import type { SSHConnection } from '../services/SSHService'

export interface ExecResult {
  stdout: string
  stdoutBytes: number
  stderr: string
  code: number
}

export interface ExecOptions {
  timeoutMs?: number
  stdin?: string | Buffer | Readable
  onOutput?: (chunk: string) => void
}

const DEFAULT_TIMEOUT_MS = 10_000

function feedStdin(stream: any, stdin: ExecOptions['stdin']): void {
  if (stdin === undefined || typeof stdin === 'string' || Buffer.isBuffer(stdin)) {
    stream.end(stdin)
    return
  }
  stdin.on('error', (err: Error) => stream.destroy(err))
  stdin.pipe(stream)
}

/**
 * Runs a command over an existing SSH connection and collects its output.
 * A `settled` flag guards against double resolution from timeout/close/error races.
 */
export function sshExec(
  conn: SSHConnection,
  command: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, stdin, onOutput }: ExecOptions = {}
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    if (conn.status !== 'connected') {
      return reject(new Error('SSH connection is not active'))
    }

    conn._client.exec(command, (err: Error | undefined, stream: any) => {
      if (err) return reject(err)

      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let settled = false

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }

      const timer = setTimeout(() => {
        settle(() => {
          stream.destroy()
          reject(new Error(`Command timed out after ${timeoutMs}ms`))
        })
      }, timeoutMs)

      stream.on('data', (d: Buffer) => { stdout.push(d); onOutput?.(d.toString('utf8')) })
      stream.stderr.on('data', (d: Buffer) => { stderr.push(d); onOutput?.(d.toString('utf8')) })
      stream.on('error', (streamErr: Error) => settle(() => reject(streamErr)))
      stream.stderr.on('error', () => {})
      stream.on('close', (code: number) => {
        const out = Buffer.concat(stdout)
        settle(() => resolve({
          stdout: out.toString('utf8'),
          stdoutBytes: out.length,
          stderr: Buffer.concat(stderr).toString('utf8'),
          code
        }))
      })

      feedStdin(stream, stdin)
    })
  })
}
