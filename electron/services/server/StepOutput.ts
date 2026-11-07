export const MAX_STEP_OUTPUT = 64 * 1024
export const REDACTED = '••••'
const MAX_STATE_LINE = 4096

const STATE_PREFIX = 'SHELLWAY_STATE '
const STATE_LINE = /^SHELLWAY_STATE ([A-Za-z_][A-Za-z0-9_]*)=(.*)$/

const isStateLine = (line: string): boolean => STATE_LINE.test(line.replace(/\r$/, ''))

const couldBeStateLine = (partial: string): boolean =>
  partial.length <= MAX_STATE_LINE && (partial.startsWith(STATE_PREFIX) || STATE_PREFIX.startsWith(partial))

export function redact(text: string, secrets: readonly string[]): string {
  return secrets.reduce((out, secret) => out.split(secret).join(REDACTED), text)
}

export const usableSecrets = (secrets: readonly string[]): string[] => [...new Set(secrets.filter((secret) => secret.length > 0))].sort((a, b) => b.length - a.length)

export interface OutputCarry {
  held: string
  partialLine: string
  lineStart: boolean
  state: Record<string, string>
}

export class StepOutput {
  readonly state: Record<string, string> = {}
  private shown: string
  private pending = ''
  private partialLine = ''
  private outgoing = ''
  private held = ''
  private lineStart: boolean
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly secrets: string[]
  private readonly holdBack: number

  constructor(secrets: readonly string[], private readonly emit: (chunk: string) => void, private readonly throttleMs: number, initial = '', carry?: OutputCarry) {
    this.secrets = usableSecrets(secrets)
    this.holdBack = Math.max(0, (this.secrets[0]?.length ?? 0) - 1)
    this.shown = initial
    this.lineStart = carry?.lineStart ?? (initial === '' || initial.endsWith('\n'))
    this.held = carry?.held ?? ''
    this.partialLine = carry?.partialLine ?? ''
    Object.assign(this.state, carry?.state)
  }

  carry(): OutputCarry {
    const partialLine = couldBeStateLine(this.partialLine) ? this.partialLine : ''
    return { held: this.held, partialLine, lineStart: this.lineStart, state: { ...this.state } }
  }

  observe(chunk: string): void {
    this.captureState(chunk)
  }

  get text(): string {
    return this.shown
  }

  push(chunk: string): void {
    this.captureState(chunk)
    const redacted = redact(this.pending + chunk, this.secrets)
    const cut = Math.max(0, redacted.length - this.holdBack)
    this.pending = redacted.slice(cut)
    this.show(redacted.slice(0, cut))
  }

  note(text: string): void {
    this.push(text)
    this.flushPending()
  }

  flush(): void {
    this.captureLine(this.partialLine)
    this.partialLine = ''
    this.flushPending()
    this.releaseHeld()
    this.drain()
  }

  private flushPending(): void {
    this.show(redact(this.pending, this.secrets))
    this.pending = ''
  }

  private show(text: string): void {
    this.display(this.withoutStateLines(text))
  }

  private withoutStateLines(text: string): string {
    const segments = (this.held + text).split('\n')
    const tail = segments.pop() ?? ''
    const kept = segments.filter((line, index) => !((index > 0 || this.lineStart) && isStateLine(line)))
    const hold = (segments.length > 0 || this.lineStart) && couldBeStateLine(tail)
    this.held = hold ? tail : ''
    this.lineStart = hold
    return kept.map((line) => `${line}\n`).join('') + (hold ? '' : tail)
  }

  private releaseHeld(): void {
    const rest = this.held
    this.held = ''
    if (!rest || isStateLine(rest)) return
    this.lineStart = false
    this.display(rest)
  }

  private display(text: string): void {
    if (!text) return
    this.shown = (this.shown + text).slice(-MAX_STEP_OUTPUT)
    this.outgoing += text
    if (this.throttleMs <= 0) return this.drain()
    this.timer ??= setTimeout(() => this.drain(), this.throttleMs)
  }

  private drain(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.outgoing) return
    const chunk = this.outgoing
    this.outgoing = ''
    this.emit(chunk)
  }

  private captureState(chunk: string): void {
    const lines = (this.partialLine + chunk).split('\n')
    this.partialLine = (lines.pop() ?? '').slice(-MAX_STATE_LINE)
    lines.forEach((line) => this.captureLine(line))
  }

  private captureLine(line: string): void {
    const match = STATE_LINE.exec(line.replace(/\r$/, ''))
    if (match) this.state[match[1]] = match[2]
  }
}
