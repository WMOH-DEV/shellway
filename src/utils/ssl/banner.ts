import type { HostnameStatus } from '../../types/ssl'
import { certCovers, daysLeft } from './verdict'
import { pluralize } from './time'

export interface CriticalBanner {
  host: string
  title: string
  detail: string
}

const isCritical = (host: HostnameStatus): boolean => host.verdict === 'broken' || host.verdict === 'will-break'

function impact(host: HostnameStatus, now: number): string {
  const notAfter = host.origin?.notAfter ?? null
  if (host.verdict === 'will-break' && notAfter !== null) return `will stop working for visitors in ${pluralize(Math.max(0, daysLeft(notAfter, now)), 'day')}`
  if (/526/.test(host.reason)) return 'is down for visitors (error 526)'
  if (/certificate error/i.test(host.reason)) return 'shows visitors a certificate error'
  return 'is down for visitors'
}

function brokenCause(host: HostnameStatus, now: number): string {
  const { origin, name } = host
  if (!origin) return ''
  if (origin.kind === 'none') return 'The server has no HTTPS certificate.'
  if (origin.kind === 'self-signed') return "The server's certificate is self-signed."
  if (origin.kind === 'cloudflare-origin' && host.edge.state !== 'proxied') return 'A Cloudflare Origin CA certificate only works behind the orange cloud.'
  if (origin.notAfter !== null && origin.notAfter <= now) return `The server's certificate expired ${pluralize(-daysLeft(origin.notAfter, now), 'day')} ago.`
  if (!certCovers(origin.names, name)) return "The server's certificate does not cover this name."
  return ''
}

function followUp(next: HostnameStatus | undefined, now: number): string {
  if (!next) return ''
  const notAfter = next.origin?.notAfter ?? null
  if (next.verdict === 'will-break' && notAfter !== null) {
    const days = daysLeft(notAfter, now)
    return days < 0 ? `${next.name} is also affected.` : `${next.name} follows in ${pluralize(days, 'day')}.`
  }
  return `${next.name} is also broken.`
}

function causeOrReason(host: HostnameStatus, now: number): string {
  if (host.verdict === 'will-break') return `${host.reason}.`
  return brokenCause(host, now)
}

export function criticalBanner(hosts: HostnameStatus[], now: number): CriticalBanner | null {
  const critical = hosts.filter(isCritical)
  const [worst, next] = critical
  if (!worst) return null
  const detail = [causeOrReason(worst, now), followUp(next, now)].filter(Boolean).join(' ')
  return { host: worst.name, title: `${worst.name} ${impact(worst, now)}.`, detail }
}
