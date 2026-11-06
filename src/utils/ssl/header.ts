import type { CloudflareStatus, ServerFacts, SslReport } from '../../types/ssl'
import { timeAgo } from '../deploy/siteStatus'
import { pluralize } from './time'
import type { Tone } from './tone'

export function hostnamesSubtitle(report: SslReport, serverName: string, now: number): string {
  const checked = `checked ${timeAgo(report.checkedAt, now)}`
  if (!report.facts.nginx) return `nginx not found on ${serverName} · ${checked}`
  return `${pluralize(report.hostnames.length, 'hostname')} served by nginx on ${serverName} · ${checked}`
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

export type NginxNoticeKind = 'missing' | 'partial' | 'unavailable'

export interface NginxNotice {
  kind: NginxNoticeKind
  text: string
}

const OTHER_SERVERS = { apache: 'Apache', caddy: 'Caddy' } as const

export function nginxNotice(facts: ServerFacts): NginxNotice | null {
  if (!facts.nginx) {
    const other = facts.otherWebServer ? ` ${OTHER_SERVERS[facts.otherWebServer]} is installed here, but Shellway only reads nginx configuration.` : ''
    return { kind: 'missing', text: `nginx was not found on this server, so there are no hostnames to list.${other}` }
  }
  if (facts.nginxParse === 'partial') {
    return { kind: 'partial', text: "Part of nginx's configuration could not be read, so some hostnames may be missing from this list." }
  }
  if (facts.nginxParse === 'unavailable') {
    return { kind: 'unavailable', text: "nginx's configuration could not be read, so hostnames cannot be listed. Check passwordless sudo for nginx under Server checks." }
  }
  return null
}
