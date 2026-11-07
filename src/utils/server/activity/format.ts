import type { ActivityEntry, ActivityWho, RunStatus, ServerArea } from '@/types/server/core'

const DAY_MS = 86_400_000

export interface ActivityDay {
  key: string
  label: string
  entries: ActivityEntry[]
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return ''
  if (ms < 1000) return '<1s'
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export function formatClock(at: number): string {
  const date = new Date(at)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function dayKey(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function dayLabel(at: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return new Date(at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function groupByDay(entries: ActivityEntry[], now: number): ActivityDay[] {
  const days: ActivityDay[] = []
  for (const entry of entries) {
    const key = dayKey(entry.at)
    const last = days[days.length - 1]
    if (last?.key === key) last.entries.push(entry)
    else days.push({ key, label: dayLabel(entry.at, now), entries: [entry] })
  }
  return days
}

export const AREA_LABEL: Record<ServerArea, string> = {
  core: 'Server',
  overview: 'Overview',
  sites: 'Sites',
  software: 'Software',
  services: 'Services',
  docker: 'Docker',
  databases: 'Databases',
  jobs: 'Cron',
  security: 'Security',
  activity: 'Activity',
  settings: 'Settings',
  setup: 'Setup'
}

export const WHO_LABEL: Record<ActivityWho, string> = {
  you: 'you',
  auto: 'auto',
  scheduled: 'scheduled',
  detected: 'detected'
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  lost: 'Lost'
}

export function entryDetail(entry: ActivityEntry): string {
  if (entry.failure) return entry.failure.message
  return entry.steps.map((step) => step.label).join(' · ')
}

export function commandsText(entry: ActivityEntry): string {
  return entry.steps.map((step) => step.display).join('\n')
}

function startOfDay(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
