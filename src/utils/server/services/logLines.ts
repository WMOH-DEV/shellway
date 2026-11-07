export type LinePriority = 'err' | 'warning' | 'info'

export const LOG_BUFFER_CAP = 5000
const TRIM_TO = 4000

const ERROR = /\b(error|crit|critical|fatal|emerg|alert|failed|failure|panic|exception)\b|\[(error|crit|emerg|alert)\]/i
const WARNING = /\b(warn|warning|notice|denied)\b|\[warn\]/i

export function guessPriority(line: string): LinePriority {
  if (ERROR.test(line)) return 'err'
  return WARNING.test(line) ? 'warning' : 'info'
}

export function splitChunk(partial: string, chunk: string): { complete: string[]; partial: string } {
  const parts = `${partial}${chunk.replace(/\r/g, '')}`.split('\n')
  const rest = parts.pop() ?? ''
  return { complete: parts, partial: rest }
}

export function capLines<T>(items: T[]): T[] {
  return items.length > LOG_BUFFER_CAP ? items.slice(-TRIM_TO) : items
}
