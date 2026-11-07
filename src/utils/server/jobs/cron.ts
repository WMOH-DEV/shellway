export interface CronField {
  raw: string
  values: ReadonlySet<number>
  any: boolean
}

export interface CronSchedule {
  minute: CronField
  hour: CronField
  day: CronField
  month: CronField
  weekday: CronField
}

export type ParsedCron = { reboot: true } | ({ reboot: false } & CronSchedule)

export type CronParseResult = { ok: true; cron: ParsedCron } | { ok: false; error: string }

interface FieldSpec {
  label: string
  min: number
  max: number
  names?: readonly string[]
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const FIELDS: readonly FieldSpec[] = [
  { label: 'minute', min: 0, max: 59 },
  { label: 'hour', min: 0, max: 23 },
  { label: 'day of month', min: 1, max: 31 },
  { label: 'month', min: 1, max: 12, names: MONTH_NAMES },
  { label: 'day of week', min: 0, max: 7, names: DAY_NAMES }
]

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *'
}

function parseNumber(text: string, spec: FieldSpec): number {
  const named = spec.names?.indexOf(text.toLowerCase()) ?? -1
  if (named >= 0) return named + (spec.min === 1 ? 1 : 0)
  if (!/^\d+$/.test(text)) throw new Error(`"${text}" is not a valid ${spec.label}`)
  const value = Number(text)
  if (value < spec.min || value > spec.max) throw new Error(`${spec.label} must be between ${spec.min} and ${spec.max}`)
  return value
}

function parseRange(text: string, spec: FieldSpec): [number, number] {
  if (text === '*') return [spec.min, spec.max]
  const [from, to, extra] = text.split('-')
  if (extra !== undefined) throw new Error(`"${text}" is not a valid range`)
  const start = parseNumber(from, spec)
  const end = to === undefined ? start : parseNumber(to, spec)
  if (end < start) throw new Error(`"${text}" runs backwards`)
  return [start, end]
}

function parsePart(part: string, spec: FieldSpec, into: Set<number>): void {
  const [range, stepText, extra] = part.split('/')
  if (extra !== undefined || range === '') throw new Error(`"${part}" is not valid`)
  if (stepText !== undefined && (!/^\d+$/.test(stepText) || Number(stepText) < 1)) throw new Error(`"${stepText}" is not a valid step`)
  if (stepText !== undefined && range !== '*' && !range.includes('-')) throw new Error(`"${part}" needs a range or * before the step`)
  const [start, end] = parseRange(range, spec)
  const step = stepText === undefined ? 1 : Number(stepText)
  for (let value = start; value <= end; value += step) into.add(spec.label === 'day of week' && value === 7 ? 0 : value)
}

function parseField(raw: string, spec: FieldSpec): CronField {
  const values = new Set<number>()
  for (const part of raw.split(',')) parsePart(part, spec, values)
  return { raw, values, any: raw.startsWith('*') }
}

export function expandMacro(expression: string): string {
  return MACROS[expression.trim().toLowerCase()] ?? expression.trim()
}

export function parseCron(expression: string): CronParseResult {
  const trimmed = expression.trim()
  if (trimmed.toLowerCase() === '@reboot') return { ok: true, cron: { reboot: true } }
  if (trimmed.startsWith('@') && !MACROS[trimmed.toLowerCase()]) return { ok: false, error: `${trimmed} is not a known schedule` }
  const parts = expandMacro(trimmed).split(/\s+/).filter(Boolean)
  if (parts.length !== 5) return { ok: false, error: 'A schedule has 5 parts: minute, hour, day of month, month, day of week' }
  try {
    const [minute, hour, day, month, weekday] = parts.map((part, index) => parseField(part, FIELDS[index]))
    return { ok: true, cron: { reboot: false, minute, hour, day, month, weekday } }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

const pad = (value: number): string => String(value).padStart(2, '0')

const NUMBER_LIST = /^\d+(,\d+)*$/
const STEP_ALL = /^\*\/(\d+)$/

const sorted = (field: CronField): number[] => [...field.values].sort((a, b) => a - b)

function joinWords(words: string[]): string {
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

function timesOf(cron: CronSchedule): string | null {
  if (!/^\d+$/.test(cron.minute.raw) || !NUMBER_LIST.test(cron.hour.raw) || cron.hour.values.size > 3) return null
  const minute = sorted(cron.minute)[0]
  return joinWords(sorted(cron.hour).map((hour) => `${pad(hour)}:${pad(minute)}`))
}

function weekdaysOf(field: CronField): string {
  if (field.raw === '1-5' || field.raw.toLowerCase() === 'mon-fri') return 'Weekdays'
  const days = sorted(field)
  if (days.length === 1) return `Every ${DAY_LABELS[days[0]]}`
  return `Every ${joinWords(days.map((day) => DAY_LABELS[day].slice(0, 3)))}`
}

function describeDaily(cron: CronSchedule, times: string): string | null {
  const dayAny = cron.day.raw === '*'
  const weekdayAny = cron.weekday.raw === '*'
  const monthAny = cron.month.raw === '*'
  if (dayAny && weekdayAny && monthAny) return `Every day at ${times}`
  if (dayAny && monthAny) return `${weekdaysOf(cron.weekday)} at ${times}`
  if (!/^\d+$/.test(cron.day.raw) || !weekdayAny) return null
  if (monthAny) return `Monthly on day ${cron.day.raw} at ${times}`
  if (cron.month.values.size === 1) return `Every year on ${MONTH_LABELS[sorted(cron.month)[0] - 1]} ${cron.day.raw} at ${times}`
  return null
}

function describeFrequent(cron: CronSchedule): string | null {
  const minuteStep = STEP_ALL.exec(cron.minute.raw)
  const hourStep = STEP_ALL.exec(cron.hour.raw)
  if (cron.minute.raw === '*' && cron.hour.raw === '*') return 'Every minute'
  if (minuteStep && cron.hour.raw === '*') return `Every ${minuteStep[1]} minutes`
  if (!/^\d+$/.test(cron.minute.raw)) return null
  const at = cron.minute.raw === '0' ? '' : ` at :${pad(Number(cron.minute.raw))}`
  if (cron.hour.raw === '*') return `Every hour${at}`
  if (hourStep) return `Every ${hourStep[1]} hours${at}`
  return null
}

export function describeCron(expression: string): string {
  const parsed = parseCron(expression)
  if (!parsed.ok) return 'Invalid schedule'
  const { cron } = parsed
  if (cron.reboot) return 'At startup'
  const everyDay = cron.day.raw === '*' && cron.month.raw === '*' && cron.weekday.raw === '*'
  const frequent = everyDay ? describeFrequent(cron) : null
  if (frequent) return frequent
  const times = timesOf(cron)
  return (times && describeDaily(cron, times)) ?? 'Custom schedule'
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const created = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
  formatters.set(timeZone, created)
  return created
}

export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC'
  try {
    formatterFor(timeZone)
    return timeZone
  } catch {
    return 'UTC'
  }
}

function wallClock(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(instant)).map((part) => [part.type, part.value]))
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
}

function instantOf(wall: number, timeZone: string): number | null {
  const firstGuess = wall - (wallClock(wall, timeZone) - wall)
  const instant = wall - (wallClock(firstGuess, timeZone) - firstGuess)
  return wallClock(instant, timeZone) === wall ? instant : null
}

function dayMatches(cron: CronSchedule, date: Date): boolean {
  const dayOk = cron.day.values.has(date.getUTCDate())
  const weekdayOk = cron.weekday.values.has(date.getUTCDay())
  if (cron.day.any || cron.weekday.any) return dayOk && weekdayOk
  return dayOk || weekdayOk
}

const MINUTE = 60_000
const SEARCH_YEARS = 8

function nextWall(cron: CronSchedule, wall: number): number | null {
  const date = new Date(wall)
  const [year, month, day, hour] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()]
  if (!cron.month.values.has(month + 1)) return Date.UTC(year, month + 1, 1)
  if (!dayMatches(cron, date)) return Date.UTC(year, month, day + 1)
  if (!cron.hour.values.has(hour)) return Date.UTC(year, month, day, hour + 1)
  if (!cron.minute.values.has(date.getUTCMinutes())) return wall + MINUTE
  return null
}

export function nextRuns(cron: ParsedCron, now: Date, timeZone: string, count = 3): Date[] {
  if (cron.reboot) return []
  const runs: Date[] = []
  let wall = Math.floor(wallClock(now.getTime(), timeZone) / MINUTE) * MINUTE + MINUTE
  const limit = wall + SEARCH_YEARS * 366 * 24 * 60 * MINUTE
  while (runs.length < count && wall < limit) {
    const skipTo = nextWall(cron, wall)
    if (skipTo !== null) {
      wall = skipTo
      continue
    }
    const instant = instantOf(wall, timeZone)
    if (instant !== null && instant > now.getTime()) runs.push(new Date(instant))
    wall += MINUTE
  }
  return runs
}

export function formatRun(run: Date, now: Date, timeZone: string): string {
  const wall = new Date(wallClock(run.getTime(), timeZone))
  const today = new Date(wallClock(now.getTime(), timeZone))
  const days = Math.round((Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000)
  const time = `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`
  if (days === 0) return `today ${time}`
  if (days === 1) return `tomorrow ${time}`
  return `${MONTH_LABELS[wall.getUTCMonth()]} ${wall.getUTCDate()} ${time}`
}

export type SchedulePreset = 'minute' | 'five' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

export interface PresetTime {
  time: string
  weekday: number
  day: number
}

export const DEFAULT_PRESET_TIME: PresetTime = { time: '03:00', weekday: 1, day: 1 }

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/

export function parseTime(time: string): { hour: number; minute: number } | null {
  const match = TIME.exec(time.trim())
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null
}

export function presetExpression(preset: Exclude<SchedulePreset, 'custom'>, input: PresetTime): string | null {
  if (preset === 'minute') return '* * * * *'
  if (preset === 'five') return '*/5 * * * *'
  if (preset === 'hourly') return '0 * * * *'
  const time = parseTime(input.time)
  if (!time) return null
  const base = `${time.minute} ${time.hour}`
  if (preset === 'daily') return `${base} * * *`
  if (preset === 'weekly') return `${base} * * ${input.weekday}`
  return `${base} ${input.day} * *`
}

const presetTime = (minute: string, hour: string): string => `${pad(Number(hour))}:${pad(Number(minute))}`

export function presetOf(expression: string): { preset: SchedulePreset; input: PresetTime } {
  const parts = expandMacro(expression).split(/\s+/)
  const custom = { preset: 'custom' as const, input: DEFAULT_PRESET_TIME }
  if (parts.length !== 5) return custom
  const [minute, hour, day, month, weekday] = parts
  const shape = parts.join(' ')
  if (shape === '* * * * *') return { preset: 'minute', input: DEFAULT_PRESET_TIME }
  if (shape === '*/5 * * * *') return { preset: 'five', input: DEFAULT_PRESET_TIME }
  if (shape === '0 * * * *') return { preset: 'hourly', input: DEFAULT_PRESET_TIME }
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || Number(minute) > 59 || Number(hour) > 23 || month !== '*') return custom
  const time = presetTime(minute, hour)
  if (day === '*' && weekday === '*') return { preset: 'daily', input: { ...DEFAULT_PRESET_TIME, time } }
  if (day === '*' && /^[0-6]$/.test(weekday)) return { preset: 'weekly', input: { ...DEFAULT_PRESET_TIME, time, weekday: Number(weekday) } }
  if (weekday === '*' && /^\d+$/.test(day) && Number(day) >= 1 && Number(day) <= 28) return { preset: 'monthly', input: { ...DEFAULT_PRESET_TIME, time, day: Number(day) } }
  return custom
}

export const WEEKDAY_LABELS = DAY_LABELS
