import type { DeployRecord, RemoteDrift, SiteSummary } from '@/types/deploy'

export type SiteBadge = 'deploying' | 'waiting' | 'failed' | 'check-stopped' | 'never' | 'behind' | 'live'

const STALE_FACTOR = 3

export function latestRecord(summary: SiteSummary): DeployRecord | undefined {
  return summary.history[0]
}

export function isCheckStale(summary: SiteSummary): boolean {
  const { config, state } = summary
  if (config.sourceMode !== 'auto' || state.heartbeat === null) return false
  return state.now - state.heartbeat > STALE_FACTOR * config.pollMinutes * 60
}

export function knownRemoteHead(summary: SiteSummary, pcDrift?: RemoteDrift): string {
  return summary.config.sourceMode === 'auto' ? summary.state.remoteHead : pcDrift?.head ?? ''
}

export function commitsBehind(summary: SiteSummary, pcDrift?: RemoteDrift): number | null {
  return summary.config.sourceMode === 'auto' ? summary.state.behind : pcDrift?.behind ?? null
}

export function isInterrupted(record: DeployRecord | undefined, summary: SiteSummary): boolean {
  return record?.status === 'running' && !summary.state.busy
}

const didFail = (record: DeployRecord | undefined, summary: SiteSummary): boolean =>
  record?.status === 'failed' || record?.status === 'reverted' || isInterrupted(record, summary)

export function siteBadge(summary: SiteSummary, pcDrift?: RemoteDrift): SiteBadge {
  const { state } = summary
  const latestDeploy = summary.history.find((r) => r.trigger !== 'env')
  if (state.busy) return 'deploying'
  if (state.pending) return 'waiting'
  if (didFail(latestRecord(summary), summary) || didFail(latestDeploy, summary)) return 'failed'
  if (isCheckStale(summary)) return 'check-stopped'
  if (!state.current) return 'never'
  const head = knownRemoteHead(summary, pcDrift)
  return head && head !== state.current ? 'behind' : 'live'
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

export function timeSpan(seconds: number): string {
  if (seconds < 60) return 'under 1 min'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`
  return `${Math.floor(seconds / 86400)} d`
}

export function timeAgo(epochSeconds: number, nowSeconds: number): string {
  const diff = Math.max(0, nowSeconds - epochSeconds)
  return diff < 60 ? 'just now' : `${timeSpan(diff)} ago`
}

export function formatSeconds(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function duration(record: DeployRecord): string {
  if (!record.finished) return ''
  return formatSeconds(Math.max(0, record.finished - record.started))
}
