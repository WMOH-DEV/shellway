import type { CheckedSide, EdgeInfo, HostnameStatus, ServerFacts, SslMode, Verdict } from '../../types/ssl'
import { timeAgo } from '../deploy/siteStatus'
import { daysLeft, KIND_LABELS, WARNING_DAYS } from './verdict'
import { formatDay, pluralize } from './time'
import { verdictTone, type Tone } from './tone'

export type HostFilter = 'all' | 'attention' | 'cloudflare' | 'certbot'

const ATTENTION_VERDICTS: ReadonlySet<Verdict> = new Set(['broken', 'will-break', 'expiring', 'not-encrypted'])
const LONG_LIVED_DAYS = 365

const FILTER_TESTS: Record<HostFilter, (host: HostnameStatus) => boolean> = {
  all: () => true,
  attention: (host) => ATTENTION_VERDICTS.has(host.verdict),
  cloudflare: (host) => host.edge.state === 'proxied',
  certbot: (host) => host.lineage !== null
}

export const matchesFilter = (host: HostnameStatus, filter: HostFilter): boolean => FILTER_TESTS[filter](host)

export function filterCounts(hosts: HostnameStatus[]): Record<HostFilter, number> {
  const count = (filter: HostFilter) => hosts.filter((h) => matchesFilter(h, filter)).length
  return { all: count('all'), attention: count('attention'), cloudflare: count('cloudflare'), certbot: count('certbot') }
}

export function groupByBlock(hosts: HostnameStatus[]): HostnameStatus[][] {
  const groups = new Map<string, HostnameStatus[]>()
  for (const host of hosts) groups.set(host.blockId, [...(groups.get(host.blockId) ?? []), host])
  return [...groups.values()]
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  broken: 'Broken now',
  'will-break': 'Will break',
  expiring: 'Expiring soon',
  'not-encrypted': 'Not encrypted to server',
  unchecked: 'Unchecked side',
  ok: 'OK'
}

export interface VerdictBadgeView {
  label: string
  tone: Tone
}

export const verdictBadge = (host: HostnameStatus): VerdictBadgeView => ({ label: VERDICT_LABELS[host.verdict], tone: verdictTone(host.verdict) })

const SIDE_LABELS: Record<CheckedSide, string> = { cloudflare: 'Cloudflare', server: 'Server' }

export function verdictHeadline(host: HostnameStatus, now: number): VerdictBadgeView {
  const tone = verdictTone(host.verdict)
  const notAfter = host.origin?.notAfter ?? null
  if (host.verdict === 'unchecked' && host.uncheckedSide) return { label: `${SIDE_LABELS[host.uncheckedSide]} side not checked`, tone }
  if (notAfter === null || (host.verdict !== 'will-break' && host.verdict !== 'expiring')) return { label: VERDICT_LABELS[host.verdict], tone }
  const days = daysLeft(notAfter, now)
  if (days < 0) return { label: `Expired ${pluralize(-days, 'day')} ago`, tone }
  const lead = host.verdict === 'will-break' ? 'Will break in' : 'Expiring in'
  return { label: `${lead} ${pluralize(days, 'day')}`, tone }
}

export interface CertView {
  kindLabel: string
  daysText: string
  tone: Tone
  life: number
}

export function lifeRatio(notBefore: number | null, notAfter: number | null, now: number): number {
  if (notBefore === null || notAfter === null || notAfter <= notBefore) return 0
  return Math.min(1, Math.max(0, (notAfter - now) / (notAfter - notBefore)))
}

function daysText(kind: string, notAfter: number | null, now: number): string {
  if (notAfter === null) return '—'
  const days = daysLeft(notAfter, now)
  if (days < 0) return `expired ${pluralize(-days, 'day')} ago`
  if (kind === 'cloudflare-origin' && days > LONG_LIVED_DAYS) return `until ${new Date(notAfter * 1000).getFullYear()}`
  return `${pluralize(days, 'day')} left`
}

function certTone(host: HostnameStatus, notAfter: number | null, now: number): Tone {
  if (notAfter === null) return 'neutral'
  const days = daysLeft(notAfter, now)
  if (days > WARNING_DAYS) return 'success'
  return days < 0 || host.verdict === 'broken' || host.verdict === 'will-break' ? 'error' : 'warning'
}

export function certView(host: HostnameStatus, now: number): CertView {
  const { origin } = host
  if (!origin) return { kindLabel: 'Not checked', daysText: '—', tone: 'neutral', life: 0 }
  if (origin.kind === 'none') return { kindLabel: KIND_LABELS.none, daysText: '—', tone: 'neutral', life: 0 }
  return {
    kindLabel: KIND_LABELS[origin.kind],
    daysText: daysText(origin.kind, origin.notAfter, now),
    tone: certTone(host, origin.notAfter, now),
    life: lifeRatio(origin.notBefore, origin.notAfter, now)
  }
}

export const SSL_MODE_LABELS: Record<SslMode, string> = {
  off: 'Off',
  flexible: 'Flexible',
  full: 'Full',
  strict: 'Full (strict)',
  origin_pull: 'Strict (origin pull)'
}

const EDGE_LABELS: Record<EdgeInfo['state'], string> = {
  proxied: 'Proxied',
  'dns-only': 'DNS only',
  'not-on-cloudflare': 'Not on Cloudflare',
  elsewhere: 'Points to another server',
  unknown: 'Unknown'
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

function edgeDetail(edge: EdgeInfo): string {
  switch (edge.state) {
    case 'proxied': return edge.sslMode ? SSL_MODE_LABELS[edge.sslMode] : 'SSL mode not visible'
    case 'dns-only': return 'not proxied'
    case 'elsewhere': return edge.recordContent ? `record points to ${edge.recordContent}` : ''
    case 'unknown': return capitalize(edge.unknownReason ?? 'reason not known')
    default: return ''
  }
}

export interface EdgeView {
  label: string
  detail: string
  proxied: boolean
}

export const edgeView = (edge: EdgeInfo): EdgeView => ({ label: EDGE_LABELS[edge.state], detail: edgeDetail(edge), proxied: edge.state === 'proxied' })

export interface RenewalView {
  title: string
  sub: string
  tone: Tone
}

export const isRenewalHealthy = (facts: ServerFacts): boolean => facts.renewal.mechanism !== 'none' && facts.renewal.lastResult !== 'failed'

function lastRunSub(facts: ServerFacts, now: number): string {
  const { lastRun, lastResult } = facts.renewal
  if (lastRun === null) return 'no run recorded'
  return lastResult === 'success' ? `last run ok · ${timeAgo(lastRun, now)}` : `last run ${formatDay(lastRun)}`
}

export function renewalView(host: HostnameStatus, facts: ServerFacts, now: number): RenewalView {
  const notAfter = host.origin?.notAfter ?? null
  if (host.origin?.kind === 'cloudflare-origin' && notAfter !== null) {
    return { title: 'Not needed', sub: `valid until ${formatDay(notAfter, true)}`, tone: 'success' }
  }
  if (!host.lineage) return { title: '—', sub: '', tone: 'neutral' }
  const { mechanism, lastResult } = facts.renewal
  if (mechanism === 'none') return { title: 'No automatic renewal', sub: '', tone: 'warning' }
  if (lastResult === 'failed') return { title: `${mechanism} failed`, sub: lastRunSub(facts, now), tone: 'error' }
  return { title: mechanism, sub: lastRunSub(facts, now), tone: lastResult === 'success' ? 'success' : 'neutral' }
}
