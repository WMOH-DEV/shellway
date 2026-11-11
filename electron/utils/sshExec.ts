import type { Readable } from 'stream'
import { StringDecoder } from 'string_decoder'
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
  onStderr?: (chunk: string) => void
  maxOutputBytes?: number
  signal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 10_000

export class ExecTimeoutError extends Error {}
export class ExecAbortedError extends Error {}

function feedStdin(stream: any, stdin: ExecOptions['stdin']): void {
  if (stdin === undefined || typeof stdin === 'string' || Buffer.isBuffer(stdin)) {
    stream.end(stdin)
    return
  }
  stdin.on('error', (err: Error) => stream.destroy(err))
  stdin.pipe(stream)
}

export class TailBuffer {
  private chunks: Buffer[] = []
  private kept = 0
  private received = 0

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.received += chunk.length
    this.chunks.push(chunk)
    this.kept += chunk.length
    while (this.kept > this.limit) this.dropFront(this.kept - this.limit)
  }

  get total(): number {
    return this.received
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks)
  }

  private dropFront(excess: number): void {
    const first = this.chunks[0]
    if (first.length <= excess) {
      this.chunks.shift()
      this.kept -= first.length
      return
    }
    this.chunks[0] = first.subarray(excess)
    this.kept -= excess
  }
}

/**
 * Runs a command over an existing SSH connection and collects its output.
 * A `settled` flag guards against double resolution from timeout/close/error races.
 */
export function sshExec(
  conn: SSHConnection,
  command: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, stdin, onOutput, onStderr = onOutput, maxOutputBytes = Infinity, signal }: ExecOptions = {}
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    if (conn.status !== 'connected') {
      return reject(new Error('SSH connection is not active'))
    }
    if (signal?.aborted) return reject(new ExecAbortedError('aborted'))

    conn._client.exec(command, (err: Error | undefined, stream: any) => {
      if (err) return reject(err)

      const stdout = new TailBuffer(maxOutputBytes)
      const stderr = new TailBuffer(maxOutputBytes)
      let settled = false

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        fn()
      }

      const onAbort = () => {
        settle(() => {
          stream.destroy()
          reject(new ExecAbortedError('aborted'))
        })
      }

      const timer = setTimeout(() => {
        settle(() => {
          stream.destroy()
          reject(new ExecTimeoutError(`Command timed out after ${timeoutMs}ms`))
        })
      }, timeoutMs)

      const outText = new StringDecoder('utf8')
      const errText = new StringDecoder('utf8')
      stream.on('data', (d: Buffer) => { stdout.push(d); onOutput?.(outText.write(d)) })
      stream.stderr.on('data', (d: Buffer) => { stderr.push(d); onStderr?.(errText.write(d)) })
      stream.on('error', (streamErr: Error) => settle(() => reject(streamErr)))
      stream.stderr.on('error', () => {})
      stream.on('close', (code: number) => {
        settle(() => resolve({
          stdout: stdout.toBuffer().toString('utf8'),
          stdoutBytes: stdout.total,
          stderr: stderr.toBuffer().toString('utf8'),
          code
        }))
      })

      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) return onAbort()
      feedStdin(stream, stdin)
    })
  })
}
