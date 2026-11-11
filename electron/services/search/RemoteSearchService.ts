import type {
  FileNameSearchRequest,
  PreviewLine,
  RemoteSearchEvent,
  RemoteSearchStarted,
  TextMatch,
  TextSearchRequest
} from '../../../src/types/search'
import type { RemoteExec } from '../deploy/DeployService'
import { ExecAbortedError, ExecTimeoutError } from '../../utils/sshExec'
import { shellEscape } from '../../utils/shellEscape'
import {
  FILE_LIMITS,
  TEXT_LIMITS,
  buildFileNameCommand,
  buildTextCommand,
  validateRemotePath
} from './remoteCommands'
import {
  createLineSplitter,
  makeMatcher,
  parseEngineMarker,
  parseFileLines,
  parseGrepLine,
  parseRgJsonLine
} from './rgJsonParser'

export interface RemoteSearchDeps {
  execFor(connectionId: string): RemoteExec | null
  send(event: RemoteSearchEvent): void
  newId(): string
  batchMs?: number
}

type Done = Extract<RemoteSearchEvent, { kind: 'done' }>

const DEFAULT_BATCH_MS = 100
const EXEC_GRACE_MS = 10_000
const OUTPUT_TAIL_BYTES = 64 * 1024
const TIMED_OUT_EXIT_CODES = new Set([124, 137])
const MAX_ERROR_LENGTH = 200
const PREVIEW_TIMEOUT_SECONDS = 5
const PREVIEW_MAX_CONTEXT = 20
const PREVIEW_MAX_COLUMNS = 400

class SearchRun<T> {
  readonly controller = new AbortController()
  private pending: T[] = []
  private timer: NodeJS.Timeout | null = null
  private finished = false
  total = 0

  constructor(
    readonly id: string,
    readonly connectionId: string,
    private readonly cap: number,
    private readonly batchMs: number,
    private readonly emit: (items: T[]) => void,
    private readonly sendDone: (done: Done) => void,
    private readonly release: () => void
  ) {}

  get isFinished(): boolean {
    return this.finished
  }

  add(items: T[]): void {
    if (this.finished || items.length === 0) return
    const room = this.cap - this.total
    const accepted = items.slice(0, room)
    this.pending.push(...accepted)
    this.total += accepted.length
    if (this.total >= this.cap) return this.finish({ truncated: true, timedOut: false })
    this.timer ??= setTimeout(() => this.flushPending(), this.batchMs)
  }

  finish(outcome: Omit<Done, 'searchId' | 'kind'>): void {
    if (this.finished) return
    this.flushPending()
    this.finished = true
    this.release()
    this.controller.abort()
    this.sendDone({ searchId: this.id, kind: 'done', ...outcome })
  }

  cancel(): void {
    if (this.finished) return
    this.discardPending()
    this.finish({ truncated: false, timedOut: false })
  }

  private flushPending(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.pending.length === 0) return
    const items = this.pending
    this.pending = []
    this.emit(items)
  }

  private discardPending(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = []
  }
}

function firstLine(text: string): string {
  return (text.split('\n').find((line) => line.trim().length > 0) ?? '').trim().slice(0, MAX_ERROR_LENGTH)
}

export class RemoteSearchService {
  private readonly runs = new Map<string, { cancel(): void }>()
  private readonly runByConnection = new Map<string, string>()

  constructor(private readonly deps: RemoteSearchDeps) {}

  findFiles(req: FileNameSearchRequest): RemoteSearchStarted {
    const { script, display } = buildFileNameCommand(req)
    const exec = this.requireExec(req.connectionId)
    const root = req.root
    const run = this.startRun<string>(req.connectionId, FILE_LIMITS.maxResults, (id, paths) =>
      this.deps.send({ searchId: id, kind: 'files', paths })
    )
    const splitter = createLineSplitter()
    const onChunk = (chunk: string) => run.add(parseFileLines(splitter.push(chunk), root))
    void this.execute(run, exec, script, FILE_LIMITS.timeoutSeconds, onChunk, () =>
      run.add(parseFileLines(splitter.flush(), root))
    )
    return { searchId: run.id, command: display }
  }

  findText(req: TextSearchRequest): RemoteSearchStarted {
    const { script, display } = buildTextCommand(req)
    const exec = this.requireExec(req.connectionId)
    const root = req.root
    const matcher = makeMatcher(req.text, req)
    const run = this.startRun<TextMatch>(req.connectionId, TEXT_LIMITS.maxMatches, (id, matches) =>
      this.deps.send({ searchId: id, kind: 'text', matches })
    )
    const splitter = createLineSplitter()
    let engine: 'rg' | 'grep' | null = null
    const parseLine = (line: string): TextMatch | null => {
      const marker = parseEngineMarker(line)
      if (marker) {
        engine = marker
        return null
      }
      if (engine === 'rg') return parseRgJsonLine(line, root)
      return engine === 'grep' ? parseGrepLine(line, root, matcher) : null
    }
    const consume = (lines: string[]) =>
      run.add(lines.map(parseLine).filter((match): match is TextMatch => match !== null))
    void this.execute(run, exec, script, TEXT_LIMITS.timeoutSeconds, (chunk) => consume(splitter.push(chunk)), () =>
      consume(splitter.flush())
    )
    return { searchId: run.id, command: display }
  }

  cancel(searchId: string): void {
    this.runs.get(searchId)?.cancel()
  }

  async preview(connectionId: string, path: string, line: number, context: number): Promise<PreviewLine[]> {
    validateRemotePath(path, 'path')
    if (!Number.isInteger(line) || line < 1) throw new Error('Invalid line')
    if (!Number.isInteger(context) || context < 0 || context > PREVIEW_MAX_CONTEXT) throw new Error('Invalid context')
    const exec = this.requireExec(connectionId)
    const first = Math.max(1, line - context)
    const script =
      `timeout ${PREVIEW_TIMEOUT_SECONDS} sed -n '${first},${line + context}p' -- ${shellEscape(path)}` +
      ` | cut -c1-${PREVIEW_MAX_COLUMNS}`
    const result = await exec(script, { timeoutMs: (PREVIEW_TIMEOUT_SECONDS + 5) * 1000, onStderr: () => undefined })
    const lines = result.stdout.split('\n').map((text) => text.replace(/\r$/, ''))
    if (lines[lines.length - 1] === '') lines.pop()
    if (lines.length === 0 && result.stderr.trim()) throw new Error(firstLine(result.stderr))
    return lines.map((text, index) => ({ line: first + index, text }))
  }

  private requireExec(connectionId: string): RemoteExec {
    const exec = this.deps.execFor(connectionId)
    if (!exec) throw new Error('Not connected')
    return exec
  }

  private startRun<T>(connectionId: string, cap: number, emit: (id: string, items: T[]) => void): SearchRun<T> {
    const previous = this.runByConnection.get(connectionId)
    if (previous) this.runs.get(previous)?.cancel()
    const id = this.deps.newId()
    const run = new SearchRun<T>(
      id,
      connectionId,
      cap,
      this.deps.batchMs ?? DEFAULT_BATCH_MS,
      (items) => emit(id, items),
      (done) => this.deps.send(done),
      () => {
        this.runs.delete(id)
        if (this.runByConnection.get(connectionId) === id) this.runByConnection.delete(connectionId)
      }
    )
    this.runs.set(id, run)
    this.runByConnection.set(connectionId, id)
    return run
  }

  private async execute<T>(
    run: SearchRun<T>,
    exec: RemoteExec,
    script: string,
    timeoutSeconds: number,
    onChunk: (chunk: string) => void,
    onEnd: () => void
  ): Promise<void> {
    try {
      const result = await exec(script, {
        timeoutMs: timeoutSeconds * 1000 + EXEC_GRACE_MS,
        maxOutputBytes: OUTPUT_TAIL_BYTES,
        onOutput: onChunk,
        onStderr: () => undefined,
        signal: run.controller.signal
      })
      onEnd()
      run.finish(this.outcomeOf(result.code, result.stderr, run.total))
    } catch (err) {
      if (err instanceof ExecAbortedError) return run.finish({ truncated: false, timedOut: false })
      if (err instanceof ExecTimeoutError) return run.finish({ truncated: false, timedOut: true })
      run.finish({ truncated: false, timedOut: false, error: firstLine((err as Error).message) || 'Search failed' })
    }
  }

  private outcomeOf(code: number, stderr: string, found: number): Omit<Done, 'searchId' | 'kind'> {
    if (TIMED_OUT_EXIT_CODES.has(code)) return { truncated: false, timedOut: true }
    if (found > 0) return { truncated: false, timedOut: false }
    const message = firstLine(stderr)
    if (message) return { truncated: false, timedOut: false, error: message }
    if (code > 1) return { truncated: false, timedOut: false, error: `Search failed (exit ${code})` }
    return { truncated: false, timedOut: false }
  }
}
