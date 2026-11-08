import type { SiteStack } from './types'

export interface CommandPreset {
  label: string
  command: string
}

const MAX_LENGTH = 500
const CONTROL_CHARS = /[\x00-\x1f\x7f]/
const HISTORY_SIZE = 10

const ARTISAN: CommandPreset[] = [
  { label: 'Run migrations', command: 'php artisan migrate --force' },
  { label: 'Clear caches', command: 'php artisan optimize:clear' },
  { label: 'Maintenance mode on', command: 'php artisan down' },
  { label: 'Maintenance mode off', command: 'php artisan up' },
  { label: 'Restart queue workers', command: 'php artisan queue:restart' }
]

const NPM: CommandPreset[] = [{ label: 'Build assets', command: 'npm run build' }]

export function commandPresets(stack: SiteStack): CommandPreset[] {
  if (stack === 'laravel') return [...ARTISAN, ...NPM]
  if (stack === 'node' || stack === 'static') return NPM
  return []
}

export function commandProblem(command: string): string | null {
  const trimmed = command.trim()
  if (trimmed === '') return 'Type a command'
  if (trimmed.length > MAX_LENGTH) return `Keep it under ${MAX_LENGTH} characters`
  if (CONTROL_CHARS.test(trimmed)) return 'Use a single line without control characters'
  return null
}

export function validCommand(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Command is missing')
  const problem = commandProblem(value)
  if (problem) throw new Error(problem)
  return value.trim()
}

export function pushHistory(history: string[], command: string): string[] {
  return [command, ...history.filter((entry) => entry !== command)].slice(0, HISTORY_SIZE)
}
