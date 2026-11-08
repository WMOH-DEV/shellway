import type { CloudflareStatus, ServerFacts, SslReport } from '../../types/ssl'
import { timeAgo } from '../deploy/siteStatus'
import { siteServerLabel } from '../webServer/siteServer'
import { pluralize } from './time'
import type { Tone } from './tone'

export function hostnamesSubtitle(report: SslReport, serverName: string, now: number): string {
  const checked = `checked ${timeAgo(report.checkedAt, now)}`
  const server = siteServerLabel(report.facts)
  if (!server) return `nginx or Apache not found on ${serverName} · ${checked}`
  return `${pluralize(report.hostnames.length, 'hostname')} served by ${server} on ${serverName} · ${checked}`
}

export interface CloudflareButtonView {
  label: string
  tone: Tone
}

const isGranted = (state: string): boolean => state === 'granted' || state === 'unknown'

export function cloudflareButton(cloudflare: CloudflareStatus): CloudflareButtonView {
  if (!cloudflare.saved) return { label: 'Add Cloudflare token', tone: 'neutral' }
  if (cloudflare.error) return { label: 'Cloudflare token problem', tone: 'error' }
  const monitoring = cloudflare.permissions.find((group) => group.id === 'monitoring')
  if (monitoring && !isGranted(monitoring.state)) return { label: 'Cloudflare: missing permissions', tone: 'warning' }
  return { label: `Cloudflare connected · ${pluralize(cloudflare.zones.length, 'zone')}`, tone: 'success' }
}

export type WebServerNoticeKind = 'missing' | 'partial' | 'unavailable'

export interface WebServerNotice {
  kind: WebServerNoticeKind
  text: string
}

export function webServerNotice(facts: ServerFacts): WebServerNotice | null {
  const server = siteServerLabel(facts)
  if (!server) {
    const caddy = facts.otherWebServer === 'caddy' ? ' Caddy is installed here, but Shellway only reads nginx and Apache configuration.' : ''
    return { kind: 'missing', text: `Neither nginx nor Apache was found on this server, so there are no hostnames to list.${caddy}` }
  }
  if (facts.nginxParse === 'partial') {
    return { kind: 'partial', text: `Part of ${server}'s configuration could not be read, so some hostnames may be missing from this list.` }
  }
  if (facts.nginxParse === 'unavailable') {
    return { kind: 'unavailable', text: `${server}'s configuration could not be read, so hostnames cannot be listed. Check passwordless sudo for ${server} under Server checks.` }
  }
  return null
}
