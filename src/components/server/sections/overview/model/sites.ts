import type { RemoteDrift, SiteConfig, SiteSummary } from '@/types/deploy'
import type { HostnameStatus, SslReport } from '@/types/ssl'
import { commitsBehind, siteBadge, type SiteBadge } from '@/utils/deploy/siteStatus'
import { daysLeft, VERDICT_ORDER } from '@/utils/ssl/verdict'
import { verdictTone } from '@/utils/ssl/tone'
import type { HealthTone } from './health'

export interface DotLabel {
  label: string
  tone: HealthTone
}

export interface SiteRowView {
  name: string
  path: string
  deploy: DotLabel
  https: DotLabel
}

const DEPLOY_LABELS: Record<SiteBadge, DotLabel> = {
  live: { label: 'live', tone: 'success' },
  behind: { label: 'new commit', tone: 'info' },
  deploying: { label: 'deploying', tone: 'info' },
  waiting: { label: 'waiting', tone: 'warning' },
  failed: { label: 'failed', tone: 'error' },
  'check-stopped': { label: 'check stopped', tone: 'warning' },
  never: { label: 'not deployed', tone: 'neutral' }
}

export function deployDot(summary: SiteSummary, drift?: RemoteDrift): DotLabel {
  const badge = siteBadge(summary, drift)
  const behind = commitsBehind(summary, drift)
  if (badge === 'behind' && behind) return { label: `${behind} behind`, tone: 'info' }
  return DEPLOY_LABELS[badge]
}

const isInside = (root: string, path: string): boolean => {
  const base = path.replace(/\/+$/, '')
  return base !== '' && (root === base || root.startsWith(`${base}/`))
}

export function hostnamesForSite(site: SiteConfig, report: SslReport): HostnameStatus[] {
  const blockIds = new Set(report.blocks.filter((block) => block.root !== null && isInside(block.root, site.path)).map((block) => block.id))
  return report.hostnames.filter((host) => blockIds.has(host.blockId) || host.name === site.name)
}

const worstHost = (hosts: HostnameStatus[]): HostnameStatus =>
  [...hosts].sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict))[0]

function httpsLabel(host: HostnameStatus, now: number): string {
  if (host.verdict === 'broken') return 'broken'
  if (host.verdict === 'not-encrypted') return 'not encrypted'
  if (host.verdict === 'unchecked') return 'unchecked'
  if (host.origin?.kind === 'cloudflare-origin' && host.verdict === 'ok') return 'Origin CA'
  if (host.origin?.notAfter) return `${daysLeft(host.origin.notAfter, now)} d`
  return 'ok'
}

const NO_REPORT: DotLabel = { label: '—', tone: 'neutral' }
const NO_HTTPS: DotLabel = { label: 'no domain', tone: 'neutral' }

export function httpsDot(site: SiteConfig, report: SslReport | null, now: number): DotLabel {
  if (!report) return NO_REPORT
  const hosts = hostnamesForSite(site, report)
  if (hosts.length === 0) return NO_HTTPS
  const host = worstHost(hosts)
  return { label: httpsLabel(host, now), tone: verdictTone(host.verdict) }
}

export function siteRows(sites: SiteSummary[], drift: Record<string, RemoteDrift>, report: SslReport | null, now: number): SiteRowView[] {
  return sites.map((summary) => ({
    name: summary.config.name,
    path: summary.config.path,
    deploy: deployDot(summary, drift[summary.config.name]),
    https: httpsDot(summary.config, report, now)
  }))
}
