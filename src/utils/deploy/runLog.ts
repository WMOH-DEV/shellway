export type StageId = 'fetch' | 'build' | 'golive' | 'after' | 'health'
export type LineTone = 'plain' | 'error' | 'warning'

export interface LogLine {
  n: number
  time: string
  text: string
  tone: LineTone
}

export interface LogSection {
  key: string
  kind: 'stage' | 'step'
  stage: StageId | null
  command: string
  optional: boolean
  exitCode: number | null
  started: number | null
  ended: number | null
  lines: LogLine[]
}

export interface ParsedLog {
  structured: boolean
  stageStarts: Partial<Record<StageId, number>>
  sections: LogSection[]
}

export const STAGE_IDS: readonly StageId[] = ['fetch', 'build', 'golive', 'after', 'health']

const MARKER = '\x1e'
const MARKER_LINE = /^\x1e(\d+) (phase|step|end) (\S+)$/
const RUNNER_LINE = /^\[(\d\d:\d\d:\d\d)\] (.*)$/
const STEP_RESULT = /^(optional )?step failed \(exit \d+\)/
const ERROR_TEXT = /\b(error|errors|fatal|failed|failure|exception|denied|refusing)\b|\bERR!|could not|cannot|not found|\[(emerg|alert|crit)\]/i
const WARNING_TEXT = /^(warning\b|optional step failed|AH00558\b)|\[warn\]|\bnpm warn\b/i

function lineTone(text: string): LineTone {
  if (WARNING_TEXT.test(text)) return 'warning'
  return ERROR_TEXT.test(text) ? 'error' : 'plain'
}

function isStageId(value: string): value is StageId {
  return (STAGE_IDS as readonly string[]).includes(value)
}

class LogBuilder {
  sections: LogSection[] = []
  stageStarts: Partial<Record<StageId, number>> = {}
  structured = false
  private stage: StageId | null = null
  private current: LogSection | null = null
  private stepClosed = false
  private lineNo = 0

  marker(time: number, kind: string, value: string): void {
    this.structured = true
    if (kind === 'phase' && isStageId(value)) this.startStage(time, value)
    else if (kind === 'step') this.startStep(time, value === 'O')
    else if (kind === 'end' && this.current?.kind === 'step') this.endStep(time, Number(value))
  }

  text(raw: string): void {
    const match = RUNNER_LINE.exec(raw)
    const time = match?.[1] ?? ''
    const text = match ? match[2] : raw
    if (this.takeAsCommand(text)) return
    if (this.stepClosed && !STEP_RESULT.test(text)) this.open('stage', this.current?.ended ?? null)
    if (!this.current) this.open('stage', null)
    this.lineNo += 1
    this.current!.lines.push({ n: this.lineNo, time, text, tone: lineTone(text) })
  }

  finish(): ParsedLog {
    this.closeStage(null)
    const sections = this.sections.filter((s) => s.kind === 'step' || s.lines.length > 0)
    return { structured: this.structured, stageStarts: this.stageStarts, sections }
  }

  private takeAsCommand(text: string): boolean {
    const section = this.current
    if (section?.kind !== 'step' || section.command || this.stepClosed || !text.startsWith('$ ')) return false
    section.command = text.slice(2)
    return true
  }

  private startStage(time: number, stage: StageId): void {
    this.closeStage(time)
    this.stage = stage
    this.stageStarts[stage] ??= time
    this.open('stage', time)
  }

  private startStep(time: number, optional: boolean): void {
    this.closeStage(time)
    this.open('step', time)
    this.current!.optional = optional
  }

  private endStep(time: number, code: number): void {
    this.current!.exitCode = Number.isFinite(code) ? code : 1
    this.current!.ended = time
    this.stepClosed = true
  }

  private closeStage(time: number | null): void {
    if (this.current?.kind === 'stage' && this.current.ended === null) this.current.ended = time
  }

  private open(kind: LogSection['kind'], started: number | null): void {
    this.stepClosed = false
    this.current = {
      key: `s${this.sections.length}`,
      kind,
      stage: this.stage,
      command: '',
      optional: false,
      exitCode: null,
      started,
      ended: null,
      lines: []
    }
    this.sections.push(this.current)
  }
}

export function parseRunLog(text: string): ParsedLog {
  const builder = new LogBuilder()
  const rows = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n')
  for (const row of rows) {
    if (row === '' && rows.length === 1) continue
    const marker = row.startsWith(MARKER) ? MARKER_LINE.exec(row) : null
    if (marker) builder.marker(Number(marker[1]), marker[2], marker[3])
    else builder.text(row)
  }
  return builder.finish()
}

export function plainLogText(text: string): string {
  return text.split('\n').filter((row) => !row.startsWith(MARKER)).join('\n')
}

export type StepResult = 'ok' | 'failed' | 'warning' | 'running'

export function stepResult(section: LogSection): StepResult {
  if (section.exitCode === null) return 'running'
  if (section.exitCode === 0) return 'ok'
  return section.optional ? 'warning' : 'failed'
}

export function failedStep(parsed: ParsedLog): LogSection | undefined {
  return [...parsed.sections].reverse().find((s) => s.kind === 'step' && stepResult(s) === 'failed')
}

export interface LogFilter {
  query: string
  errorsOnly: boolean
}

function lineMatches(line: LogLine, filter: LogFilter): boolean {
  if (filter.errorsOnly && line.tone !== 'error') return false
  return !filter.query || line.text.toLowerCase().includes(filter.query.toLowerCase())
}

function commandMatches(section: LogSection, filter: LogFilter): boolean {
  return !filter.errorsOnly && filter.query !== '' && section.command.toLowerCase().includes(filter.query.toLowerCase())
}

export function filterSections(sections: LogSection[], filter: LogFilter): LogSection[] {
  if (!filter.query && !filter.errorsOnly) return sections
  return sections.flatMap((section) => {
    if (commandMatches(section, filter)) return [section]
    const lines = section.lines.filter((line) => lineMatches(line, filter))
    return lines.length > 0 ? [{ ...section, lines }] : []
  })
}
