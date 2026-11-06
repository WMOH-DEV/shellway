import type { DeployRecord, RemoteDrift, SiteConfig, SiteSummary } from '@/types/deploy'
import { parseGitHubRepo } from './githubRepo'
import { commitCount, liveRecord, runTone, triggerLabel, type RunTone } from './siteRow'
import { commitsBehind, isCheckStale, isInterrupted, knownRemoteHead, shortSha, timeAgo } from './siteStatus'

export type HistoryFilter = 'all' | 'failed' | 'warnings'

const UNSUCCESSFUL: ReadonlySet<RunTone> = new Set(['failed', 'cancelled'])

export function matchesHistoryFilter(record: DeployRecord, filter: HistoryFilter, summary: SiteSummary): boolean {
  if (filter === 'failed') return UNSUCCESSFUL.has(runTone(record, summary))
  if (filter === 'warnings') return record.status === 'warning' || record.warnings > 0
  return true
}

export function matchesHistorySearch(record: DeployRecord, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [record.subject, record.commit.slice(0, 12), record.trigger, record.note, recordTitle(record)]
    .some((value) => value.toLowerCase().includes(needle))
}

export function recordTitle(record: DeployRecord): string {
  if (record.trigger === 'env') return 'Env file changed'
  if (record.subject) return record.subject
  if (record.trigger === 'rollback') return 'Rollback'
  return record.commit ? `Commit ${shortSha(record.commit)}` : 'Deploy'
}

export function canRollBackTo(summary: SiteSummary, record: DeployRecord): boolean {
  if (record.trigger === 'env' || (record.status !== 'success' && record.status !== 'warning')) return false
  if (summary.config.layout === 'releases') return record.id !== summary.state.currentRelease
  return record.commit !== summary.state.current
}

export function rollbackTarget(summary: SiteSummary): DeployRecord | undefined {
  return summary.history.find((record) => canRollBackTo(summary, record))
}

export function canRetry(record: DeployRecord, summary: SiteSummary): boolean {
  const latest = summary.history.find((r) => r.trigger !== 'env')
  return latest?.id === record.id && UNSUCCESSFUL.has(runTone(record, summary))
}

export function deployLabel(summary: SiteSummary, pcDrift?: RemoteDrift): string {
  const behind = commitsBehind(summary, pcDrift)
  return behind && behind > 0 ? `Deploy ${commitCount(behind)}` : 'Deploy'
}

export function liveCaption(summary: SiteSummary): string {
  const { state, config } = summary
  const live = liveRecord(summary)
  const parts = live ? [triggerLabel(live.trigger), timeAgo(live.finished ?? live.started, state.now)] : []
  if (config.layout === 'releases' && state.currentRelease) parts.push(`release ${state.currentRelease}`)
  return parts.join(' · ')
}

export interface NewestView {
  head: string
  subject: string
  caption: string
}

export function newestView(summary: SiteSummary, pcDrift?: RemoteDrift): NewestView | null {
  const head = knownRemoteHead(summary, pcDrift)
  if (!head) return null
  const { state } = summary
  const subject = head === state.current ? state.currentSubject : head === state.remoteHead ? state.remoteSubject : ''
  const behind = commitsBehind(summary, pcDrift)
  if (head === state.current) return { head, subject, caption: 'Same as live' }
  const caption = behind ? `${commitCount(behind)} ahead of live` : state.current ? 'Newer than live' : 'Not deployed yet'
  return { head, subject, caption }
}

export interface SourceView {
  label: string
  caption: string
  tone: 'success' | 'warning' | 'muted'
}

export function sourceView(summary: SiteSummary): SourceView {
  const { config, state } = summary
  if (config.sourceMode === 'pc') {
    return { label: 'From my PC', caption: config.pcAuto ? 'while Shellway is open' : 'on click', tone: 'muted' }
  }
  const checked = state.heartbeat === null ? 'not checked yet' : `checked ${timeAgo(state.heartbeat, state.now)}`
  return { label: 'Auto on server', caption: `every ${config.pollMinutes} min · ${checked}`, tone: isCheckStale(summary) ? 'warning' : 'success' }
}

export function repoLabel(url: string): string {
  const repo = parseGitHubRepo(url)
  return repo ? `${repo.owner}/${repo.repo}` : url
}

export function layoutLabel(config: SiteConfig): string {
  return config.layout === 'releases' ? `Releases, ${config.keepReleases} kept` : 'In place'
}

export type RunStatusTone = 'success' | 'warning' | 'error' | 'info' | 'muted'

const RUN_STATUS: Record<DeployRecord['status'] | 'interrupted', { label: string; tone: RunStatusTone }> = {
  running: { label: 'Running', tone: 'info' },
  success: { label: 'Success', tone: 'success' },
  warning: { label: 'Warning', tone: 'warning' },
  failed: { label: 'Failed', tone: 'error' },
  reverted: { label: 'Switched back', tone: 'error' },
  waiting: { label: 'Waiting for approval', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  interrupted: { label: 'Interrupted', tone: 'error' }
}

export function runStatus(record: DeployRecord, summary: SiteSummary): { label: string; tone: RunStatusTone } {
  return RUN_STATUS[isInterrupted(record, summary) ? 'interrupted' : record.status]
}

export function isLiveRecord(summary: SiteSummary, record: DeployRecord): boolean {
  if (summary.config.layout === 'releases') return record.id === summary.state.currentRelease
  return liveRecord(summary)?.id === record.id
}
