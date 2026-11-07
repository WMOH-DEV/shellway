import runScript from '../../../resources/server/shellway-run.sh?raw'
import type { RemoteExec } from '../deploy/DeployService'
import { Disconnected } from './remote'

export const RUN_BIN = '"$HOME/.shellway/bin/shellway-run"'
const RUNS_DIR = '"$HOME/.shellway/runs"'
const BUNDLED_VERSION = Number(/RUN_VERSION=(\d+)/.exec(runScript)?.[1] ?? 0)
const CONTROL_TIMEOUT_MS = 30_000
const CHUNK_BYTES = 65536
const FIRST_POLL_MS = 1500
const MAX_POLL_MS = 10_000
const GRACE_SECONDS = 120
const REMOTE_ID = /^[A-Za-z0-9-]{1,100}$/

export interface DetachedRef {
  remoteId: string
  pid: number
  follow: boolean
  root: boolean
  offset: number
  limitSeconds: number
  startedAt: number
}

export type DetachedOutcome = { kind: 'exit'; code: number } | { kind: 'lost' } | { kind: 'timeout' }

export interface DetachedWatch {
  onChunk(chunk: string): void
  onProgress(ref: DetachedRef): void
  stopRequested(): boolean
}

interface RemoteStatus {
  known: boolean
  alive: boolean
  exit: number | null
  chunk: string
  chunkBytes: number
}

export interface DetachedDeps {
  now(): number
  sleep(ms: number): Promise<void>
}

const sudoPrefix = (root: boolean): string => (root ? 'sudo -n ' : '')

function checkedId(remoteId: string): string {
  if (!REMOTE_ID.test(remoteId)) throw new Error('Invalid run id')
  return remoteId
}

function failure(stdout: string, stderr: string, fallback: string): Error {
  return new Error((stderr || stdout).trim().replace(/^error:\s*/, '') || fallback)
}

export function parseStart(stdout: string): { pid: number; follow: boolean } | null {
  const pid = Number(/^pid=(\d+)$/m.exec(stdout)?.[1])
  return Number.isInteger(pid) && pid > 0 ? { pid, follow: /^follow=1$/m.test(stdout) } : null
}

export function parseRead(stdout: string, stdoutBytes: number): RemoteStatus {
  const newline = stdout.indexOf('\n')
  const header = newline >= 0 ? stdout.slice(0, newline) : stdout
  const fields = Object.fromEntries(header.split(' ').slice(1).map((pair) => pair.split('=')))
  const exit = fields.exit === undefined || fields.exit === '' ? null : Number(fields.exit)
  const chunk = newline >= 0 ? stdout.slice(newline + 1) : ''
  return {
    known: fields.known === '1',
    alive: fields.alive === '1',
    exit: exit !== null && Number.isInteger(exit) ? exit : null,
    chunk,
    chunkBytes: newline >= 0 ? Math.max(0, stdoutBytes - Buffer.byteLength(header) - 1) : 0
  }
}

export class DetachedSteps {
  private readonly installed = new Set<string>()

  constructor(private readonly deps: DetachedDeps) {}

  static get bundledVersion(): number {
    return BUNDLED_VERSION
  }

  forget(connectionId: string): void {
    this.installed.delete(connectionId)
  }

  async ensureRunner(exec: RemoteExec, connectionId: string): Promise<void> {
    if (this.installed.has(connectionId)) return
    const current = await exec(`${RUN_BIN} version 2>/dev/null`, { timeoutMs: CONTROL_TIMEOUT_MS })
    if (current.code !== 0 || Number.parseInt(current.stdout.trim(), 10) !== BUNDLED_VERSION) await this.install(exec)
    this.installed.add(connectionId)
  }

  async start(exec: RemoteExec, remoteId: string, root: boolean, limitSeconds: number, input: string): Promise<DetachedRef> {
    const command = `${sudoPrefix(root)}${RUN_BIN} start ${checkedId(remoteId)} ${limitSeconds}`
    const result = await exec(command, { stdin: input, timeoutMs: CONTROL_TIMEOUT_MS })
    const started = result.code === 0 ? parseStart(result.stdout) : null
    if (!started) throw failure(result.stdout, result.stderr, 'The step could not be started on the server')
    return { remoteId, ...started, root, offset: 0, limitSeconds, startedAt: this.deps.now() }
  }

  async kill(exec: RemoteExec, ref: DetachedRef): Promise<void> {
    await exec(`${sudoPrefix(ref.root)}${RUN_BIN} kill ${checkedId(ref.remoteId)}`, { timeoutMs: CONTROL_TIMEOUT_MS })
  }

  async follow(exec: RemoteExec, ref: DetachedRef, watch: DetachedWatch): Promise<DetachedOutcome> {
    if (watch.stopRequested()) await this.kill(exec, ref)
    if (ref.follow) await this.tail(exec, ref, watch)
    let delay = FIRST_POLL_MS
    for (;;) {
      const status = await this.read(exec, ref, watch)
      if (status.chunkBytes >= CHUNK_BYTES) continue
      if (status.exit !== null) return { kind: 'exit', code: status.exit }
      if (!status.known || !status.alive) return { kind: 'lost' }
      if (watch.stopRequested()) await this.kill(exec, ref)
      if (this.isPastDeadline(ref)) return { kind: 'timeout' }
      await this.deps.sleep(delay)
      delay = Math.min(Math.round(delay * 1.5), MAX_POLL_MS)
    }
  }

  isPastDeadline(ref: DetachedRef): boolean {
    return this.deps.now() > this.deadline(ref)
  }

  pause(ms: number): Promise<void> {
    return this.deps.sleep(ms)
  }

  private deadline(ref: DetachedRef): number {
    return ref.startedAt + (ref.limitSeconds + GRACE_SECONDS) * 1000
  }

  private async tail(exec: RemoteExec, ref: DetachedRef, watch: DetachedWatch): Promise<void> {
    const command = `tail -c +${ref.offset + 1} --pid=${ref.pid} -f ${RUNS_DIR}/${checkedId(ref.remoteId)}.log`
    const timeoutMs = Math.max(this.deadline(ref) - this.deps.now(), 1000)
    let streamed = 0
    const onOutput = (chunk: string) => {
      streamed += Buffer.byteLength(chunk)
      watch.onChunk(chunk)
    }
    try {
      const result = await exec(command, { timeoutMs, onOutput, maxOutputBytes: CHUNK_BYTES })
      ref.offset += result.code === 0 ? result.stdoutBytes : streamed
    } catch (err) {
      ref.offset += streamed
      if (err instanceof Disconnected) throw err
    }
    watch.onProgress(ref)
  }

  private async read(exec: RemoteExec, ref: DetachedRef, watch: DetachedWatch): Promise<RemoteStatus> {
    const result = await exec(`${RUN_BIN} read ${checkedId(ref.remoteId)} ${ref.offset}`, { timeoutMs: CONTROL_TIMEOUT_MS })
    if (result.code !== 0) throw failure(result.stdout, result.stderr, 'Could not read the step status')
    const status = parseRead(result.stdout, result.stdoutBytes)
    if (status.chunk) watch.onChunk(status.chunk)
    ref.offset += status.chunkBytes
    watch.onProgress(ref)
    return status
  }

  private async install(exec: RemoteExec): Promise<void> {
    const command = `mkdir -p "$HOME/.shellway/bin" ${RUNS_DIR} && chmod 700 "$HOME/.shellway" ${RUNS_DIR} && cat > ${RUN_BIN}.tmp && chmod 755 ${RUN_BIN}.tmp && mv -f ${RUN_BIN}.tmp ${RUN_BIN}`
    const result = await exec(command, { stdin: runScript.replace(/\r\n/g, '\n'), timeoutMs: CONTROL_TIMEOUT_MS })
    if (result.code !== 0) throw failure(result.stdout, result.stderr, 'Could not install the Shellway run helper')
  }
}
