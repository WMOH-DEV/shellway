import type { CronEntry, LastRun, ShellwayTask } from './types'

export const CRON_LOG_DIR = '/var/log/shellway'
export const USER_CRONTAB = 'crontab'

export const cronLogPath = (id: string): string => `${CRON_LOG_DIR}/cron-${id}.log`

export interface TaskLine {
  id: string
  expression: string
  command: string
  logOutput: boolean
}

const TAG = /^(.*) # shellway:([a-z0-9][a-z0-9-]{0,47})$/
const WRAPPED = /^\((.*)\) (?:>> \S+|> \/dev\/null) 2>&1; echo "shellway-exit \$\? \$\(date \+\\%s\)" (>>|>) \S+$/
const ENV_LINE = /^[A-Za-z_][A-Za-z0-9_]*\s*=/
const USER_ENTRY = /^(@\S+|\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/
const SYSTEM_ENTRY = /^(@\S+|\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(\S+)\s+(.+)$/

const escapePercent = (command: string): string => command.replace(/%/g, '\\%')
const unescapePercent = (command: string): string => command.replace(/\\%/g, '%')

export function shellwayCronLine(task: TaskLine): string {
  const log = cronLogPath(task.id)
  const run = task.logOutput ? `(${escapePercent(task.command)}) >> ${log} 2>&1` : `(${escapePercent(task.command)}) > /dev/null 2>&1`
  const mark = `echo "shellway-exit $? $(date +\\%s)" ${task.logOutput ? '>>' : '>'} ${log}`
  return `${task.expression} ${run}; ${mark} # shellway:${task.id}`
}

function readShellwayCommand(text: string): { command: string; shellway: ShellwayTask | null } {
  const tagged = TAG.exec(text)
  if (!tagged) return { command: text, shellway: null }
  const wrapped = WRAPPED.exec(tagged[1])
  if (!wrapped) return { command: tagged[1], shellway: { id: tagged[2], logOutput: false } }
  return { command: unescapePercent(wrapped[1]), shellway: { id: tagged[2], logOutput: wrapped[2] === '>>' } }
}

const isEntryLine = (line: string): boolean => line !== '' && !line.startsWith('#') && !ENV_LINE.test(line)

export const crontabLines = (text: string): string[] => (text === '' ? [] : text.replace(/\n$/, '').split('\n'))

function entryOf(user: string, source: string, line: number, expression: string, rest: string): CronEntry {
  const { command, shellway } = readShellwayCommand(rest)
  const ref = shellway ? `shellway:${shellway.id}` : `line:${line}`
  return { ref, user, source, line, expression: expression.replace(/\s+/g, ' '), command, shellway, lastRun: null }
}

export function parseUserCrontab(text: string, user: string): CronEntry[] {
  return crontabLines(text).flatMap((raw, line) => {
    const trimmed = raw.trim()
    const match = isEntryLine(trimmed) ? USER_ENTRY.exec(trimmed) : null
    return match ? [entryOf(user, USER_CRONTAB, line, match[1], match[2])] : []
  })
}

export function parseSystemCrontab(text: string, source: string): CronEntry[] {
  return crontabLines(text).flatMap((raw, line) => {
    const trimmed = raw.trim()
    const match = isEntryLine(trimmed) ? SYSTEM_ENTRY.exec(trimmed) : null
    return match ? [{ ...entryOf(match[2], source, line, match[1], match[3]), ref: `${source}:${line}` }] : []
  })
}

export function parseLastRun(text: string): LastRun | null {
  const match = /shellway-exit (\d+) (\d+)/.exec(text)
  return match ? { exitCode: Number(match[1]), at: Number(match[2]) * 1000 } : null
}

export function replaceEntry(text: string, line: number | null, next: string | null): string {
  const lines = crontabLines(text)
  if (line === null && next !== null) lines.push(next)
  else if (line !== null) lines.splice(line, 1, ...(next === null ? [] : [next]))
  return lines.length ? `${lines.join('\n')}\n` : ''
}
