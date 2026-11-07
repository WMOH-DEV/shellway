import type { ServerFacts } from '@/types/server/core'
import type { BackupFacts, DbEngine, EngineFacts, EngineStatus, RedisFacts, SiteEnvFacts } from './types'

export const MYSQL_PROBE = 'databases.mysql'
export const POSTGRES_PROBE = 'databases.postgresql'
export const REDIS_PROBE = 'databases.redis'
export const BACKUPS_PROBE = 'databases.backups'
export const SITES_PROBE = 'databases.sites'

export const ENGINE_PROBE: Record<DbEngine, string> = { mysql: MYSQL_PROBE, postgresql: POSTGRES_PROBE }

export function emptyEngine(engine: DbEngine, status: EngineStatus, reason: string): EngineFacts {
  return { engine, status, reason, flavor: engine, version: '', listen: [], databases: [], users: [] }
}

function okData<T>(facts: ServerFacts, id: string): T | null {
  const result = facts[id]
  return result?.status === 'ok' ? (result.data as T) : null
}

export const engineFacts = (facts: ServerFacts, engine: DbEngine): EngineFacts | null => okData<EngineFacts>(facts, ENGINE_PROBE[engine])

export const redisFacts = (facts: ServerFacts): RedisFacts | null => okData<RedisFacts>(facts, REDIS_PROBE)

export const backupFacts = (facts: ServerFacts): BackupFacts | null => okData<BackupFacts>(facts, BACKUPS_PROBE)

export const siteEnvFacts = (facts: ServerFacts): SiteEnvFacts | null => okData<SiteEnvFacts>(facts, SITES_PROBE)

export const engineLabel = (engine: DbEngine): string => (engine === 'mysql' ? 'MySQL' : 'PostgreSQL')

export const userDatabases = (data: EngineFacts | null): string[] =>
  data?.status === 'ok' ? data.databases.filter((database) => !database.system).map((database) => database.name) : []
