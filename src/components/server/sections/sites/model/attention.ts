import type { AttentionItem, ServerRoute } from '@/types/server/core'
import type { HostnameStatus, Verdict } from '@/types/ssl'
import { siteBadge } from '@/utils/deploy/siteStatus'
import { verdictHeadline } from '@/utils/ssl/hostRow'
import type { SitesJoin } from '@/utils/server/sites/join'

const FAILED_DEPLOY_RANK = 160
const BROKEN_CERT_RANK = 170
const EXPIRING_CERT_RANK = 85

const CERT_RANKS: Partial<Record<Verdict, number>> = {
  broken: BROKEN_CERT_RANK,
  'will-break': BROKEN_CERT_RANK,
  expiring: EXPIRING_CERT_RANK
}

export const siteRoute = (site: string, tab?: string): ServerRoute => ({ section: 'sites', sub: 'site', params: tab ? { site, tab } : { site } })

export const hostnameRoute = (name: string): ServerRoute => ({ section: 'sites', sub: 'hostname', params: { name } })

function certItem(host: HostnameStatus, route: ServerRoute, now: number): AttentionItem | null {
  const rank = CERT_RANKS[host.verdict]
  if (rank === undefined) return null
  return {
    id: `sites.cert.${host.name}`,
    area: 'sites',
    level: rank >= 100 ? 'error' : 'warning',
    rank,
    title: `${host.name}: ${verdictHeadline(host, now).label.toLowerCase()}`,
    detail: host.reason,
    actionLabel: 'Fix HTTPS',
    route
  }
}

export function sitesAttention(join: SitesJoin, now: number): AttentionItem[] {
  const deployItems = join.sites
    .filter((entry) => siteBadge(entry.summary) === 'failed')
    .map<AttentionItem>((entry) => ({
      id: `sites.deploy.${entry.summary.config.name}`,
      area: 'sites',
      level: 'error',
      rank: FAILED_DEPLOY_RANK,
      title: `Last deploy of ${entry.domain ?? entry.summary.config.name} failed`,
      detail: entry.summary.history[0]?.note || 'Open the run log to see which command failed.',
      actionLabel: 'Review',
      route: siteRoute(entry.summary.config.name, 'deployments')
    }))
  const siteCerts = join.sites.flatMap((entry) => entry.hosts.map((host) => certItem(host, siteRoute(entry.summary.config.name, 'domains'), now)))
  const otherCerts = join.otherHosts.map((host) => certItem(host, hostnameRoute(host.name), now))
  const certItems = [...siteCerts, ...otherCerts].filter((item): item is AttentionItem => item !== null)
  return [...deployItems, ...certItems].sort((a, b) => b.rank - a.rank)
}
