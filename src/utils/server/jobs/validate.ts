import { parseCron } from './cron'

export const WORKER_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/
export const PROGRAM_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
export const PROCESS_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}(:[A-Za-z0-9][A-Za-z0-9_.-]{0,99})?$/
export const PM2_NAME = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,99}$/
export const USER_NAME = /^[a-z_][a-z0-9_.-]{0,31}$/
export const TASK_ID = /^[a-z0-9][a-z0-9-]{0,47}$/
export const TASK_REF = /^(shellway:[a-z0-9][a-z0-9-]{0,47}|line:\d{1,5})$/
const DIRECTORY = /^\/[A-Za-z0-9._/@+-]{0,255}$/
const EXPRESSION_CHARS = /^[A-Za-z0-9*,/@ -]{1,100}$/
const MAX_COMMAND = 2000

export type Raw = Record<string, unknown>

export function record(raw: unknown): Raw {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid parameters')
  return raw as Raw
}

export function text(raw: Raw, key: string, pattern: RegExp, what: string): string {
  const value = raw[key]
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${what} is not valid`)
  return value
}

export function oneOf<T extends string>(raw: Raw, key: string, allowed: readonly T[]): T {
  const value = raw[key]
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${key} must be one of ${allowed.join(', ')}`)
  return value as T
}

export function flag(raw: Raw, key: string): boolean {
  const value = raw[key]
  if (typeof value !== 'boolean') throw new Error(`${key} must be true or false`)
  return value
}

export function integer(raw: Raw, key: string, min: number, max: number): number {
  const value = raw[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be a whole number from ${min} to ${max}`)
  return value
}

export function command(raw: Raw, key = 'command'): string {
  const value = raw[key]
  if (typeof value !== 'string' || value.trim() === '') throw new Error('Enter a command')
  if (/[\r\n\0]/.test(value)) throw new Error('The command must be on one line')
  if (value.length > MAX_COMMAND) throw new Error(`The command is longer than ${MAX_COMMAND} characters`)
  return value.trim()
}

export function directory(raw: Raw, key = 'directory'): string {
  const value = text(raw, key, DIRECTORY, 'The folder')
  if (value.split('/').includes('..')) throw new Error('The folder is not valid')
  return value
}

export function expression(raw: Raw, key = 'expression'): string {
  const value = raw[key]
  if (typeof value !== 'string' || /[\r\n]/.test(value) || !EXPRESSION_CHARS.test(value.trim())) throw new Error('The schedule is not valid')
  const parsed = parseCron(value)
  if (!parsed.ok) throw new Error(parsed.error)
  return value.trim().replace(/\s+/g, ' ')
}

export function cronCommandProblem(value: string): string | null {
  if (/(^|\s)#/.test(value)) return 'Remove the # comment from the command'
  return null
}

export function supervisorCommandProblem(value: string): string | null {
  if (/\s;/.test(value)) return 'Supervisor reads " ;" as the start of a comment. Remove it or wrap the command in a script.'
  return null
}

export function checked(value: string, problem: (value: string) => string | null): string {
  const message = problem(value)
  if (message) throw new Error(message)
  return value
}
