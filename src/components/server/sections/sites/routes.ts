import type { ServerRoute } from '@/types/server/core'
import { hostnameRoute, siteRoute } from './model/attention'

export { hostnameRoute, siteRoute }

export type SiteTab = 'overview' | 'deployments' | 'pipeline' | 'domains' | 'env' | 'workers' | 'logs' | 'settings' | 'commands'

export const SITE_TABS: { id: SiteTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'deployments', label: 'Deployments' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'domains', label: 'Domains & HTTPS' },
  { id: 'env', label: 'Environment' },
  { id: 'workers', label: 'Workers & cron' },
  { id: 'logs', label: 'Logs' },
  { id: 'commands', label: 'Commands' },
  { id: 'settings', label: 'Settings' }
]

export const siteTab = (value: string | undefined): SiteTab => SITE_TABS.find((tab) => tab.id === value)?.id ?? 'overview'

function withParams(sub: string, params: Record<string, string | undefined>): ServerRoute {
  const defined = Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined))
  return { section: 'sites', sub, params: defined }
}

export const sitesRoute = (): ServerRoute => ({ section: 'sites' })
export const createRoute = (): ServerRoute => ({ section: 'sites', sub: 'create' })
export const addRoute = (): ServerRoute => ({ section: 'sites', sub: 'add' })
export const keyRoute = (site: string): ServerRoute => withParams('key', { site })
export const sslSettingsRoute = (site?: string): ServerRoute => withParams('ssl-settings', { site })
export const httpsRoute = (blockId?: string, site?: string): ServerRoute => withParams('https', { blockId, site })
export const originRoute = (name: string, site?: string): ServerRoute => withParams('origin', { name, site })
export const zoneRoute = (zone: string, site?: string, from?: string): ServerRoute => withParams('zone', { zone, site, from })

export const returnRoute = (site: string | undefined): ServerRoute => (site ? siteRoute(site, 'domains') : sitesRoute())
