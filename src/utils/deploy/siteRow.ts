import type { DeployProgress, DeployRecord, DeployStage, RemoteDrift, SiteConfig, SiteSummary } from '@/types/deploy'
import { commitsBehind, duration, isInterrupted, latestRecord, siteBadge, timeAgo, timeSpan, type SiteBadge } from './siteStatus'

export type SiteFilter = 'all' | 'attention' | 'auto' | 'pc'
export type RunTone = 'success' | 'warning' | 'failed' | 'running' | 'waiting' | 'cancelled'
export type RowAction = 'deploy' | 'cancel' | 'review' | 'resume'

export interface Chip {
  label: string
  tone: 'info' | 'warning' | 'muted'
}

export interface ProgressView {
  label: string
  step: string
  command: string
  fraction: number
}

export interface AwaySummary {
  total: number
  succeeded: number
  failed: number
  waiting: number
  cancelled: number
  failedSites: string[]
}

const RECENT_RUNS = 10
const ATTENTION: ReadonlySet<SiteBadge> = new Set(['failed', 'waiting', 'check-stopped'])
const CANCELLABLE: ReadonlySet<DeployStage> = new Set(['fetch', 'build'])
const IN_PLACE_CANCELLABLE: ReadonlySet<DeployStage> = new Set(['fetch'])
const AWAY_TRIGGERS: ReadonlySet<string> = new Set(['auto', 'pc'])

const STAGE_LABELS: Record<DeployStage, string> = {
  fetch: 'Fetching code',
  build: 'Building',
  activate: 'Going live',
  health: 'Checking health'
}

const TRIGGER_LABELS: Record<string, string> = {
  pc: 'from PC',
  approve: 'approved'
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export const commitCount = (count: number) => plural(count, 'commit')

export function matchesFilter(summary: SiteSummary, filter: SiteFilter, pcDrift?: RemoteDrift): boolean {
  if (filter === 'attention') return ATTENTION.has(siteBadge(summary, pcDrift))
  if (filter === 'auto' || filter === 'pc') return summary.config.sourceMode === filter
  return true
}

export function matchesSearch(summary: SiteSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const { name, path, repoUrl, branch } = summary.config
  return [name, path, repoUrl, branch].some((value) => value.toLowerCase().includes(needle))
}

export function filterCounts(sites: SiteSummary[], pcDrift: Record<string, RemoteDrift>): Record<SiteFilter, number> {
  const count = (filter: SiteFilter) => sites.filter((s) => matchesFilter(s, filter, pcDrift[s.config.name])).length
  return { all: sites.length, attention: count('attention'), auto: count('auto'), pc: count('pc') }
}

export function shortPath(path: string, user: string): string {
  if (!user) return path
  const home = user === 'root' ? '/root' : `/home/${user}`
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function runTone(record: DeployRecord, summary: SiteSummary): RunTone {
  if (record.status === 'reverted' || isInterrupted(record, summary)) return 'failed'
  return record.status
}

export function recentRuns(summary: SiteSummary): RunTone[] {
  return summary.history.slice(0, RECENT_RUNS).reverse().map((record) => runTone(record, summary))
}

export function runsCaption(summary: SiteSummary): string {
  const last = latestRecord(summary)
  if (!last) return 'No runs yet'
  const ended = last.finished ?? last.started
  const { now } = summary.state
  switch (runTone(last, summary)) {
    case 'running': return 'running'
    case 'waiting': return `waiting ${timeSpan(Math.max(0, now - ended))}`
    case 'failed': return `failed ${timeAgo(ended, now)}`
    case 'cancelled': return `cancelled ${timeAgo(ended, now)}`
    default: return duration(last)
  }
}

export function liveRecord(summary: SiteSummary): DeployRecord | undefined {
  const { current } = summary.state
  return summary.history.find((r) => r.commit === current && (r.status === 'success' || r.status === 'warning'))
}

export function triggerLabel(trigger: string): string {
  return TRIGGER_LABELS[trigger] ?? trigger
}

export function behindChip(summary: SiteSummary, pcDrift?: RemoteDrift): Chip | null {
  const behind = commitsBehind(summary, pcDrift)
  if (summary.state.pending) return { label: `${behind ? `${behind} new` : 'new commit'} · adds a migration`, tone: 'warning' }
  if (!summary.state.current || siteBadge(summary, pcDrift) === 'behind' || behind === null) return null
  return behind > 0 ? { label: `${commitCount(behind)} behind`, tone: 'info' } : { label: 'Up to date', tone: 'muted' }
}

export function sourceMeta(config: SiteConfig): string {
  const layout = config.layout === 'releases' ? 'Releases' : 'In place'
  const schedule = config.sourceMode === 'auto'
    ? `every ${config.pollMinutes} min`
    : config.pcAuto ? 'while Shellway is open' : 'on click'
  return [config.branch, layout, schedule].join(' · ')
}

export function progressView(progress: DeployProgress | null): ProgressView {
  if (!progress) return { label: 'Starting', step: '', command: '', fraction: 0 }
  const { stage, step, steps, command } = progress
  const running = command !== '' && step > 0 && steps > 0
  const done = running ? step - 1 : step
  const fraction = stage === 'health' ? 1 : stage === 'fetch' || steps === 0 ? 0 : Math.min(1, Math.max(0, done / steps))
  return {
    label: STAGE_LABELS[stage],
    step: running ? `step ${step} of ${steps}` : '',
    command: running ? command : '',
    fraction
  }
}

function cancellableStages(summary: SiteSummary): ReadonlySet<DeployStage> {
  return summary.config.layout === 'inplace' ? IN_PLACE_CANCELLABLE : CANCELLABLE
}

export function canCancel(summary: SiteSummary): boolean {
  const { busy, cancelling, progress } = summary.state
  return busy && !cancelling && (!progress || cancellableStages(summary).has(progress.stage))
}

export function cancelBlockedReason(summary: SiteSummary): string {
  if (summary.state.cancelling) return 'Cancelling…'
  if (summary.config.layout === 'inplace' && summary.state.progress?.stage === 'build') {
    return 'This site updates in place and its code already changed; stopping now would leave it half-built'
  }
  return "Already going live; it can't be stopped now"
}

export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function rowAction(badge: SiteBadge): RowAction {
  if (badge === 'deploying') return 'cancel'
  if (badge === 'waiting') return 'review'
  if (badge === 'check-stopped') return 'resume'
  return 'deploy'
}

export function awaySummary(sites: SiteSummary[], since: number | null): AwaySummary | null {
  if (since === null) return null
  const runs = sites.flatMap((summary) => summary.history
    .filter((r) => AWAY_TRIGGERS.has(r.trigger) && (r.finished ?? r.started) > since)
    .map((r) => ({ site: summary.config.name, tone: runTone(r, summary) }))
    .filter((r) => r.tone !== 'running'))
  if (runs.length === 0) return null
  const count = (tones: RunTone[]) => runs.filter((r) => tones.includes(r.tone)).length
  return {
    total: runs.length,
    succeeded: count(['success', 'warning']),
    failed: count(['failed']),
    waiting: count(['waiting']),
    cancelled: count(['cancelled']),
    failedSites: [...new Set(runs.filter((r) => r.tone === 'failed').map((r) => r.site))]
  }
}

export interface AwayOutcome {
  text: string
  tone: 'plain' | 'error' | 'warning'
}

export function awayParts(summary: AwaySummary): { runs: string; outcomes: AwayOutcome[] } {
  const outcomes: AwayOutcome[] = []
  if (summary.succeeded > 0) outcomes.push({ text: `${summary.succeeded} succeeded`, tone: 'plain' })
  if (summary.failed > 0) outcomes.push({ text: `${summary.failed} failed on ${summary.failedSites.join(', ')}`, tone: 'error' })
  if (summary.waiting > 0) outcomes.push({ text: `${summary.waiting} waiting for approval`, tone: 'warning' })
  if (summary.cancelled > 0) outcomes.push({ text: `${summary.cancelled} cancelled`, tone: 'plain' })
  return { runs: plural(summary.total, 'auto deploy'), outcomes }
}
