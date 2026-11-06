import type { CertKind, CheckedSide, EdgeInfo, OriginCert, Verdict } from '../../types/ssl'

export const WARNING_DAYS = 14
const DAY_SECONDS = 86_400

export const VERDICT_ORDER: readonly Verdict[] = ['broken', 'will-break', 'expiring', 'not-encrypted', 'unchecked', 'ok']

export const KIND_LABELS: Record<CertKind, string> = {
  letsencrypt: "Let's Encrypt",
  'cloudflare-origin': 'Cloudflare Origin CA',
  'self-signed': 'Self-signed',
  other: 'Other',
  none: 'No certificate'
}

export interface VerdictInput {
  host: string
  origin: OriginCert | null
  edge: EdgeInfo
  certbotManaged: boolean
  renewalHealthy: boolean
  now: number
}

export interface VerdictResult {
  verdict: Verdict
  reason: string
  uncheckedSide: CheckedSide | null
}

export function daysLeft(notAfter: number, now: number): number {
  return Math.floor((notAfter - now) / DAY_SECONDS)
}

export function certCovers(names: string[], host: string): boolean {
  const wanted = host.toLowerCase()
  return names.some((raw) => {
    const name = raw.toLowerCase()
    if (name === wanted) return true
    if (!name.startsWith('*.')) return false
    const dot = wanted.indexOf('.')
    return dot > 0 && wanted.slice(dot + 1) === name.slice(2)
  })
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function isUnusable(origin: OriginCert, host: string, now: number): boolean {
  if (origin.kind === 'none' || origin.kind === 'self-signed') return true
  if (origin.notAfter !== null && origin.notAfter <= now) return true
  return !certCovers(origin.names, host)
}

function brokenReason({ host, origin, edge, now }: VerdictInput): string | null {
  if (!origin) return null
  if (edge.state === 'proxied') {
    if (origin.kind === 'none' && (edge.sslMode === 'full' || edge.sslMode === 'strict')) return 'Cloudflare cannot reach the server over HTTPS'
    if (edge.sslMode === 'strict' && isUnusable(origin, host, now)) return 'Visitors get error 526'
    return null
  }
  const direct = edge.state === 'dns-only' || edge.state === 'not-on-cloudflare'
  if (!direct || origin.kind === 'none') return null
  if (origin.kind === 'cloudflare-origin' || isUnusable(origin, host, now)) return 'Visitors get a certificate error'
  return null
}

function expiryVerdict(input: VerdictInput): VerdictResult | null {
  const { origin, now, certbotManaged, renewalHealthy } = input
  if (!origin || origin.notAfter === null || origin.kind === 'none') return null
  const days = daysLeft(origin.notAfter, now)
  if (days > WARNING_DAYS) return null
  if (days < 0) return { verdict: 'will-break', reason: `Expired ${plural(-days, 'day')} ago`, uncheckedSide: null }
  if (!certbotManaged) return { verdict: 'will-break', reason: `Expires in ${plural(days, 'day')} and nothing renews it`, uncheckedSide: null }
  if (!renewalHealthy) return { verdict: 'will-break', reason: `Expires in ${plural(days, 'day')} and renewal is not working`, uncheckedSide: null }
  return { verdict: 'expiring', reason: 'certbot should have renewed at 30 days left', uncheckedSide: null }
}

function okReason(origin: OriginCert, now: number): string {
  if (origin.notAfter === null) return KIND_LABELS[origin.kind]
  return `${KIND_LABELS[origin.kind]} · ${plural(daysLeft(origin.notAfter, now), 'day')} left`
}

export function verdictFor(input: VerdictInput): VerdictResult {
  const { origin, edge } = input
  const broken = brokenReason(input)
  if (broken) return { verdict: 'broken', reason: broken, uncheckedSide: null }
  const expiry = expiryVerdict(input)
  if (expiry) return expiry
  if (origin?.kind === 'none') return { verdict: 'not-encrypted', reason: 'No HTTPS certificate on the server', uncheckedSide: null }
  if (edge.state === 'proxied' && (edge.sslMode === 'flexible' || edge.sslMode === 'off')) {
    return { verdict: 'not-encrypted', reason: 'Cloudflare reaches the server over plain HTTP', uncheckedSide: null }
  }
  if (!origin) return { verdict: 'unchecked', reason: 'Server side: not checked', uncheckedSide: 'server' }
  if (edge.state === 'unknown') return { verdict: 'unchecked', reason: `Cloudflare side: ${edge.unknownReason ?? 'unknown'}`, uncheckedSide: 'cloudflare' }
  return { verdict: 'ok', reason: okReason(origin, input.now), uncheckedSide: null }
}
