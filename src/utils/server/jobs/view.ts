import type { CronEntry, CrontabFacts } from './types'

export interface SitePath {
  name: string
  path: string
  workDir: string
}

export const siteWorkDir = (path: string, layout: 'releases' | 'inplace'): string => (layout === 'releases' ? `${path}/current` : path)

export function siteFor(directory: string, sites: readonly SitePath[]): SitePath | null {
  const matches = sites.filter((site) => directory === site.path || directory.startsWith(`${site.path}/`))
  return matches.sort((a, b) => b.path.length - a.path.length)[0] ?? null
}

const SKIPPED_WORDS = new Set(['cd', 'php', 'artisan', 'sh', 'bash', 'node', 'npm', 'run', 'sudo', 'env'])

export function taskSlug(command: string): string {
  const words = (command.split('&&').at(-1) ?? '')
    .split(/\s+/)
    .filter((word) => word && !word.startsWith('-') && !word.startsWith('/') && !word.includes('>') && !SKIPPED_WORDS.has(word))
  const slug = words.join('-').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '')
  return slug || 'task'
}

export function newTaskId(command: string, random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 0x10000).toString(16).padStart(4, '0')
  return `${taskSlug(command)}-${suffix}`
}

export function laravelSchedulerCommand(sitePath: string): string {
  return `cd ${sitePath} && php artisan schedule:run >> /dev/null 2>&1`
}

export const LARAVEL_QUEUE_COMMAND = 'php artisan queue:work --sleep=3 --tries=3 --max-time=3600'
export const LARAVEL_HORIZON_COMMAND = 'php artisan horizon'

export const plainCommand = (entry: CronEntry): string => (entry.shellway ? entry.command : entry.command.replace(/\\%/g, '%'))

export function userTasks(facts: CrontabFacts | null): CronEntry[] {
  return (facts?.crontabs ?? []).flatMap((crontab) => crontab.entries)
}

export type LastResultTone = 'success' | 'error' | 'neutral'

export function lastResult(entry: CronEntry, now: number): { text: string; tone: LastResultTone } {
  if (!entry.lastRun) return { text: entry.shellway ? 'Not run yet' : 'Not logged', tone: 'neutral' }
  const ago = agoText(entry.lastRun.at, now)
  if (entry.lastRun.exitCode === 0) return { text: `ok · ${ago}`, tone: 'success' }
  return { text: `failed (exit ${entry.lastRun.exitCode}) · ${ago}`, tone: 'error' }
}

export function agoText(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86_400)} d ago`
}
