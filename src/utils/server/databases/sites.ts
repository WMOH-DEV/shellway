import type { ActionStep } from '@/types/server/core'
import { fileEditStep } from '../fileEdit'
import { envDiff, setEnvKeys, type EnvEntry } from './env'
import type { DbEngine, EngineFacts, SiteEnv } from './types'

export const SITE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

const DRIVER: Record<DbEngine, string[]> = { mysql: ['mysql', 'mariadb'], postgresql: ['pgsql'] }

const DEFAULT_PORT: Record<DbEngine, number> = { mysql: 3306, postgresql: 5432 }

const MYSQL_X_PORT = 33060

export interface SiteLink {
  site: string
  byName: boolean
}

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '_')

const sameEngine = (site: SiteEnv, engine: DbEngine): boolean => site.db.connection === '' || DRIVER[engine].includes(site.db.connection)

export function linkedSite(engine: DbEngine, database: string, sites: SiteEnv[]): SiteLink | null {
  const byEnv = sites.find((site) => site.db.database === database && sameEngine(site, engine))
  if (byEnv) return { site: byEnv.site, byName: false }
  const byName = sites.find((site) => database === slug(site.site) || database.startsWith(`${slug(site.site)}_`))
  return byName ? { site: byName.site, byName: true } : null
}

export function sitesUsingUser(engine: DbEngine, user: string, sites: SiteEnv[]): SiteEnv[] {
  return sites.filter((site) => site.db.username === user && sameEngine(site, engine))
}

export function listenPort(engine: DbEngine, listen: string[]): number {
  const ports = listen.map((address) => Number(address.slice(address.lastIndexOf(':') + 1))).filter((port) => Number.isInteger(port) && port > 0)
  if (ports.includes(DEFAULT_PORT[engine])) return DEFAULT_PORT[engine]
  return ports.find((port) => port !== MYSQL_X_PORT) ?? DEFAULT_PORT[engine]
}

export function connectionEntries(data: EngineFacts, database: string, user: string, password?: string): EnvEntry[] {
  return [
    ['DB_CONNECTION', data.engine === 'mysql' ? 'mysql' : 'pgsql'],
    ['DB_HOST', '127.0.0.1'],
    ['DB_PORT', String(listenPort(data.engine, data.listen))],
    ['DB_DATABASE', database],
    ['DB_USERNAME', user],
    ...(password ? [['DB_PASSWORD', password] as EnvEntry] : [])
  ]
}

export function siteEnvProblem(site: SiteEnv | undefined, name: string): string | null {
  if (!site) return `Shellway could not find the site ${name}. Refresh and try again.`
  if (!site.readable) return `Shellway cannot read ${name}'s env file (${site.path}). Create it in the site's Environment page first.`
  return null
}

export function siteEnvStep(site: SiteEnv, entries: EnvEntry[]): ActionStep {
  return fileEditStep({
    id: 'site-env',
    label: `Update ${site.site}'s env file`,
    path: site.path,
    content: setEnvKeys(site.content, entries),
    originalSha256: site.sha256,
    owner: site.owner,
    mode: site.mode,
    diff: envDiff(site.content, entries)
  })
}
