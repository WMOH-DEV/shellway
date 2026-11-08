import type { EdgeInfo, HostnameStatus, OriginCert, ServerFacts } from '../../types/ssl'
import { SSL_MODE_LABELS } from './hostRow'
import { formatDay, pluralize } from './time'
import type { Tone } from './tone'
import { certCovers, daysLeft, KIND_LABELS, WARNING_DAYS } from './verdict'

export interface CardView {
  tone: Tone
  chip: string
  sentence: string
  detail: string
}

export interface ConnectorView {
  tone: Tone
  failing: boolean
  protocol: 'HTTPS' | 'HTTP' | ''
  label: string
}

export interface DiagramView {
  cloudflare: CardView | null
  server: CardView
  visitorLeg: ConnectorView
  originLeg: ConnectorView | null
}

interface Problem {
  chip: string
  sentence: string
}

const BROWSER_CHECKS = 'browser checks'
const CLOUDFLARE_CHECKS = 'Cloudflare checks'

export function issuerLabel(origin: OriginCert): string {
  return origin.issuer || KIND_LABELS[origin.kind]
}

function renewalClause(host: HostnameStatus, facts: ServerFacts): string {
  const { mechanism, lastRun, lastResult } = facts.renewal
  if (!host.lineage) return ' Nothing renews it.'
  if (mechanism === 'none') return ' Nothing renews it automatically.'
  if (lastResult === 'failed') return lastRun === null ? " certbot's last renewal failed." : ` certbot's renewal last failed on ${formatDay(lastRun)}.`
  return host.verdict === 'expiring' ? ' certbot should have renewed it at 30 days left.' : ''
}

function usabilityProblem(host: HostnameStatus, origin: OriginCert, facts: ServerFacts, now: number): Problem | null {
  if (origin.kind === 'self-signed') return { chip: 'Self-signed', sentence: 'Your server presents a self-signed certificate.' }
  if (origin.notAfter !== null && origin.notAfter <= now) {
    return { chip: 'Expired', sentence: `Your server's certificate expired on ${formatDay(origin.notAfter, true)}.${renewalClause(host, facts)}` }
  }
  if (!certCovers(origin.names, host.name)) return { chip: 'Wrong name', sentence: "Your server's certificate does not cover this name." }
  if (origin.kind === 'cloudflare-origin' && host.edge.state !== 'proxied') {
    return { chip: 'Not trusted', sentence: 'Your server uses a Cloudflare Origin CA certificate, which browsers do not trust.' }
  }
  return null
}

const isPlainHttpMode = (edge: EdgeInfo): boolean => edge.state === 'proxied' && (edge.sslMode === 'flexible' || edge.sslMode === 'off')

function consequence(host: HostnameStatus): string {
  if (host.verdict === 'broken') return `${host.reason}.`
  if (host.verdict !== 'will-break') return ''
  if (host.edge.state === 'proxied') return host.edge.sslMode === 'strict' ? 'When it expires, visitors get error 526.' : ''
  return 'When it expires, visitors get a certificate error.'
}

function missingCertCard(host: HostnameStatus): CardView {
  const { edge } = host
  const tone: Tone = host.verdict === 'broken' ? 'error' : 'warning'
  const tail = isPlainHttpMode(edge)
    ? ' Cloudflare reaches it over plain HTTP.'
    : edge.state === 'proxied' && (edge.sslMode === 'full' || edge.sslMode === 'strict') ? ' Cloudflare cannot connect to it over HTTPS.' : ''
  return { tone, chip: 'No certificate', sentence: `Your server has no HTTPS certificate.${tail}`, detail: consequence(host) }
}

function healthyCard(host: HostnameStatus, origin: OriginCert): CardView {
  const until = origin.notAfter === null ? '' : ` until ${formatDay(origin.notAfter, true)}`
  const detail = issuerLabel(origin)
  if (isPlainHttpMode(host.edge)) {
    return { tone: 'warning', chip: 'Not used', sentence: 'Cloudflare reaches your server over plain HTTP, so this certificate is never checked.', detail }
  }
  const renewal = origin.kind === 'cloudflare-origin' ? ' It does not need renewing.' : host.lineage ? ' certbot renews it automatically.' : ''
  return { tone: 'success', chip: 'OK', sentence: `Your server's certificate is valid${until}.${renewal}`, detail }
}

export function serverCard(host: HostnameStatus, facts: ServerFacts, now: number): CardView {
  const { origin } = host
  if (!origin) {
    return { tone: 'neutral', chip: 'Not checked', sentence: "Shellway could not read this name's certificate from your server.", detail: host.reason }
  }
  if (origin.kind === 'none') return missingCertCard(host)
  const problem = usabilityProblem(host, origin, facts, now)
  if (problem) return { tone: host.verdict === 'broken' ? 'error' : 'warning', ...problem, detail: consequence(host) || issuerLabel(origin) }
  if (origin.notAfter !== null && daysLeft(origin.notAfter, now) <= WARNING_DAYS) {
    const days = daysLeft(origin.notAfter, now)
    return {
      tone: host.verdict === 'will-break' ? 'error' : 'warning',
      chip: `${pluralize(days, 'day')} left`,
      sentence: `Your server's certificate expires on ${formatDay(origin.notAfter, true)}.${renewalClause(host, facts)}`,
      detail: consequence(host) || issuerLabel(origin)
    }
  }
  return healthyCard(host, origin)
}

function cloudflareDetail(edge: EdgeInfo): string {
  const parts = ['Proxied', edge.sslMode ? `SSL mode ${SSL_MODE_LABELS[edge.sslMode]}` : null, edge.zone ? `zone ${edge.zone}` : null]
  return parts.filter(Boolean).join(' · ')
}

export function cloudflareCard(edge: EdgeInfo): CardView {
  if (edge.state === 'unknown') {
    return {
      tone: 'neutral',
      chip: 'Not checked',
      sentence: `Shellway cannot see Cloudflare's side: ${edge.unknownReason ?? 'reason not known'}.`,
      detail: "Only your server's side was checked."
    }
  }
  const onward = isPlainHttpMode(edge) ? ' It then talks to your server over plain HTTP.' : ' It renews it automatically.'
  return { tone: 'success', chip: 'OK', sentence: `Cloudflare shows visitors its own certificate.${onward}`, detail: cloudflareDetail(edge) }
}

function directLeg(server: CardView): ConnectorView {
  return { tone: server.tone, failing: server.tone === 'error', protocol: 'HTTPS', label: BROWSER_CHECKS }
}

function originLeg(edge: EdgeInfo, server: CardView): ConnectorView {
  if (isPlainHttpMode(edge)) return { tone: 'warning', failing: false, protocol: 'HTTP', label: CLOUDFLARE_CHECKS }
  return { tone: server.tone, failing: server.tone === 'error', protocol: 'HTTPS', label: CLOUDFLARE_CHECKS }
}

const DIRECT_NOTES: Partial<Record<EdgeInfo['state'], string>> = {
  'dns-only': 'DNS only: visitors connect straight to your server.',
  'not-on-cloudflare': 'Not on Cloudflare: visitors connect straight to your server.',
  elsewhere: 'DNS points to another server, so visitors do not reach this one.'
}

const directNote = (edge: EdgeInfo): string => DIRECT_NOTES[edge.state] ?? ''

export function diagramView(host: HostnameStatus, facts: ServerFacts, now: number): DiagramView {
  const { edge } = host
  const server = serverCard(host, facts, now)
  if (edge.state === 'proxied') {
    return {
      cloudflare: cloudflareCard(edge),
      server,
      visitorLeg: { tone: 'success', failing: false, protocol: 'HTTPS', label: BROWSER_CHECKS },
      originLeg: originLeg(edge, server)
    }
  }
  if (edge.state === 'unknown') {
    const neutral = (label: string): ConnectorView => ({ tone: 'neutral', failing: false, protocol: '', label })
    return { cloudflare: cloudflareCard(edge), server, visitorLeg: neutral(BROWSER_CHECKS), originLeg: neutral(CLOUDFLARE_CHECKS) }
  }
  const direct = { ...server, detail: [directNote(edge), server.detail].filter(Boolean).join(' ') }
  return { cloudflare: null, server: direct, visitorLeg: directLeg(direct), originLeg: null }
}
