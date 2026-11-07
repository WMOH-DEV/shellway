import type { RemoteDrift } from '@/types/deploy'
import type { HostnameStatus, Verdict } from '@/types/ssl'
import { siteBadge, type SiteBadge } from '@/utils/deploy/siteStatus'
import { certView, edgeView, verdictHeadline } from '@/utils/ssl/hostRow'
import type { Tone } from '@/utils/ssl/tone'
import { vhostFor } from '@/utils/server/sites/inventory'
import { plainBlock, siteFile, siteStack, worstHost, type SiteEntry } from '@/utils/server/sites/join'
import type { SitesInventory, SiteStack } from '@/utils/server/sites/types'
import { phpVersionIn, vhostServer } from '@/utils/server/sites/vhost'

export type SiteRowAction = 'cancel' | 'review' | 'resume' | 'fix-https' | 'add-https' | 'deploy'
export type SiteFilter = 'all' | 'attention' | 'php' | 'node' | 'static' | 'docker'

export interface HttpsView {
  label: string
  sub: string
  tone: Tone
}

const HTTPS_RISK: ReadonlySet<Verdict> = new Set(['broken', 'will-break', 'expiring'])
const DEPLOY_ATTENTION: ReadonlySet<SiteBadge> = new Set(['failed', 'waiting', 'check-stopped'])

const STACK_FILTER: Record<SiteStack, SiteFilter> = {
  laravel: 'php',
  php: 'php',
  node: 'node',
  static: 'static',
  docker: 'docker'
}

export const hasHttpsRisk = (entry: SiteEntry): boolean => entry.hosts.some((h) => HTTPS_RISK.has(h.verdict))

function hostSub(host: HostnameStatus, now: number): string {
  const edge = edgeView(host.edge)
  const headline = verdictHeadline(host, now)
  if (host.verdict !== 'ok') return headline.label
  return edge.proxied ? `proxied · ${edge.detail}` : edge.label
}

export function httpsView(entry: SiteEntry, now: number): HttpsView {
  if (plainBlock(entry)) return { label: 'No HTTPS', sub: 'HTTP only', tone: 'warning' }
  const host = worstHost(entry.hosts)
  if (!host) return { label: 'Not found', sub: 'no web server site matched', tone: 'neutral' }
  const cert = certView(host, now)
  const label = cert.daysText === '—' ? cert.kindLabel : `${cert.kindLabel} · ${cert.daysText}`
  return { label, sub: hostSub(host, now), tone: host.verdict === 'ok' ? 'success' : cert.tone === 'neutral' ? 'warning' : cert.tone }
}

export function siteRowAction(entry: SiteEntry, badge: SiteBadge): SiteRowAction {
  if (badge === 'deploying') return 'cancel'
  if (badge === 'failed' || badge === 'waiting') return 'review'
  if (badge === 'check-stopped') return 'resume'
  if (hasHttpsRisk(entry)) return 'fix-https'
  if (plainBlock(entry)) return 'add-https'
  return 'deploy'
}

export function needsAttention(entry: SiteEntry, pcDrift?: RemoteDrift): boolean {
  return DEPLOY_ATTENTION.has(siteBadge(entry.summary, pcDrift)) || hasHttpsRisk(entry)
}

export function matchesSiteFilter(entry: SiteEntry, filter: SiteFilter, pcDrift?: RemoteDrift): boolean {
  if (filter === 'all') return true
  if (filter === 'attention') return needsAttention(entry, pcDrift)
  return STACK_FILTER[siteStack(entry.summary)] === filter
}

export function matchesSiteSearch(entry: SiteEntry, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const { name, path, repoUrl, branch } = entry.summary.config
  return [name, path, repoUrl, branch, ...entry.hosts.map((h) => h.name)].some((value) => value.toLowerCase().includes(needle))
}

export function siteFilterCounts(entries: SiteEntry[], pcDrift: Record<string, RemoteDrift>): Record<SiteFilter, number> {
  const filters: SiteFilter[] = ['all', 'attention', 'php', 'node', 'static', 'docker']
  return Object.fromEntries(filters.map((f) => [f, entries.filter((e) => matchesSiteFilter(e, f, pcDrift[e.summary.config.name])).length])) as Record<SiteFilter, number>
}

export function siteRuntime(entry: SiteEntry, inventory: SitesInventory | null): string | null {
  const file = siteFile(entry)
  if (!file) return null
  const vhost = vhostFor(inventory, file)
  const server = vhostServer(vhost?.realPath ?? file)
  const php = vhost ? phpVersionIn(vhost.content) : null
  const parts = [php && `PHP ${php}`, server && (server.kind === 'nginx' ? 'nginx' : 'Apache')].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}
