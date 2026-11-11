import type {
  CachedService,
  CachedSite,
  CachedTable,
  SearchCachePatch,
  SearchCacheSnapshot,
  SearchCacheStats,
  UsageEntry
} from '../types/search'

export const CACHE_VERSION = 1

export const CACHE_LIMITS = {
  name: 256,
  path: 1024,
  resultId: 512,
  databasesPerScope: 200,
  tablesPerDatabase: 5000,
  columnsPerTable: 300,
  pathsPerScope: 5000,
  sites: 500,
  services: 1000,
  usage: 2000,
  learnedKeys: 500,
  learnedPerKey: 10,
  learnedKeyLength: 24
} as const

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export function emptySnapshot(): SearchCacheSnapshot {
  return { version: CACHE_VERSION, tables: {}, servers: {}, paths: {}, usage: {}, learned: {} }
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || text.length > max || CONTROL_CHARS.test(text)) return null
  return text
}

function cleanList<T>(values: unknown, max: number, clean: (v: unknown) => T | null): T[] {
  if (!Array.isArray(values)) return []
  const out: T[] = []
  for (const v of values) {
    const item = clean(v)
    if (item !== null) out.push(item)
    if (out.length >= max) break
  }
  return out
}

function cleanTable(value: unknown): CachedTable | null {
  const raw = value as Partial<CachedTable> | null
  const name = cleanText(raw?.name, CACHE_LIMITS.name)
  if (!name) return null
  return {
    name,
    type: raw?.type === 'view' ? 'view' : 'table',
    columns: cleanList(raw?.columns, CACHE_LIMITS.columnsPerTable, (c) => cleanText(c, CACHE_LIMITS.name))
  }
}

function cleanSite(value: unknown): CachedSite | null {
  const raw = value as Partial<CachedSite> | null
  const name = cleanText(raw?.name, CACHE_LIMITS.name)
  if (!name) return null
  const root = cleanText(raw?.root, CACHE_LIMITS.path)
  return root?.startsWith('/') ? { name, root } : { name }
}

function cleanService(value: unknown): CachedService | null {
  const raw = value as Partial<CachedService> | null
  const id = cleanText(raw?.id, CACHE_LIMITS.name)
  const name = cleanText(raw?.name, CACHE_LIMITS.name)
  if (!id || !name) return null
  return { id, name, kind: raw?.kind === 'container' ? 'container' : 'service' }
}

function cleanPath(value: unknown): string | null {
  const path = cleanText(value, CACHE_LIMITS.path)
  return path?.startsWith('/') ? path : null
}

export function learnedKey(queryText: string): string {
  return queryText.trim().toLowerCase().slice(0, CACHE_LIMITS.learnedKeyLength)
}

function keepNewest<T>(record: Record<string, T>, max: number, at: (v: T) => number): Record<string, T> {
  const entries = Object.entries(record)
  if (entries.length <= max) return record
  return Object.fromEntries(entries.sort(([, a], [, b]) => at(b) - at(a)).slice(0, max))
}

function withTables(s: SearchCacheSnapshot, scopeId: string, database: string, tables: unknown): SearchCacheSnapshot {
  const scope = { ...s.tables[scopeId], [database]: cleanList(tables, CACHE_LIMITS.tablesPerDatabase, cleanTable) }
  const names = Object.keys(scope)
  if (names.length > CACHE_LIMITS.databasesPerScope) delete scope[names[0]]
  return { ...s, tables: { ...s.tables, [scopeId]: scope } }
}

function withPaths(s: SearchCacheSnapshot, scopeId: string, paths: unknown): SearchCacheSnapshot {
  const fresh = cleanList(paths, CACHE_LIMITS.pathsPerScope, cleanPath)
  const merged = [...new Set([...fresh, ...(s.paths[scopeId] ?? [])])].slice(0, CACHE_LIMITS.pathsPerScope)
  return { ...s, paths: { ...s.paths, [scopeId]: merged } }
}

function withUsage(s: SearchCacheSnapshot, resultId: string, queryText: string, now: number): SearchCacheSnapshot {
  const prev = s.usage[resultId]
  const entry: UsageEntry = { count: (prev?.count ?? 0) + 1, lastUsedAt: now }
  const usage = keepNewest({ ...s.usage, [resultId]: entry }, CACHE_LIMITS.usage, (u) => u.lastUsedAt)
  const key = learnedKey(queryText)
  if (!key) return { ...s, usage }
  const picks = { ...s.learned[key], [resultId]: (s.learned[key]?.[resultId] ?? 0) + 1 }
  const trimmed = Object.fromEntries(Object.entries(picks).sort(([, a], [, b]) => b - a).slice(0, CACHE_LIMITS.learnedPerKey))
  const learned = { ...s.learned, [key]: trimmed }
  const keys = Object.keys(learned)
  if (keys.length > CACHE_LIMITS.learnedKeys) delete learned[keys[0] === key ? keys[1] : keys[0]]
  return { ...s, usage, learned }
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record
  return rest
}

export function applyPatch(s: SearchCacheSnapshot, patch: SearchCachePatch, now: number): SearchCacheSnapshot {
  if (patch.kind === 'usage') {
    const resultId = cleanText(patch.resultId, CACHE_LIMITS.resultId)
    return resultId ? withUsage(s, resultId, typeof patch.queryText === 'string' ? patch.queryText : '', now) : s
  }
  const scopeId = cleanText(patch.scopeId, CACHE_LIMITS.name)
  if (!scopeId) return s
  switch (patch.kind) {
    case 'tables': {
      const database = cleanText(patch.database, CACHE_LIMITS.name)
      return database ? withTables(s, scopeId, database, patch.tables) : s
    }
    case 'server':
      return {
        ...s,
        servers: {
          ...s.servers,
          [scopeId]: {
            sites: cleanList(patch.sites, CACHE_LIMITS.sites, cleanSite),
            services: cleanList(patch.services, CACHE_LIMITS.services, cleanService),
            updatedAt: now
          }
        }
      }
    case 'paths':
      return withPaths(s, scopeId, patch.paths)
    case 'forget':
      return { ...s, tables: without(s.tables, scopeId), servers: without(s.servers, scopeId), paths: without(s.paths, scopeId) }
    default:
      return s
  }
}

export function normalizeSnapshot(raw: unknown): SearchCacheSnapshot {
  const value = raw as Partial<SearchCacheSnapshot> | null
  if (!value || value.version !== CACHE_VERSION) return emptySnapshot()
  let s = emptySnapshot()
  for (const [scopeId, dbs] of Object.entries(value.tables ?? {})) {
    for (const [database, tables] of Object.entries(dbs ?? {})) s = applyPatch(s, { kind: 'tables', scopeId, database, tables }, 0)
  }
  for (const [scopeId, server] of Object.entries(value.servers ?? {})) {
    s = applyPatch(s, { kind: 'server', scopeId, sites: server?.sites ?? [], services: server?.services ?? [] }, server?.updatedAt ?? 0)
  }
  for (const [scopeId, paths] of Object.entries(value.paths ?? {})) s = applyPatch(s, { kind: 'paths', scopeId, paths }, 0)
  for (const [id, entry] of Object.entries(value.usage ?? {})) {
    if (cleanText(id, CACHE_LIMITS.resultId) && Number.isFinite(entry?.count) && Number.isFinite(entry?.lastUsedAt)) {
      s.usage[id] = { count: entry.count, lastUsedAt: entry.lastUsedAt }
    }
  }
  for (const [key, picks] of Object.entries(value.learned ?? {})) {
    const clean = Object.entries(picks ?? {}).filter(([id, n]) => cleanText(id, CACHE_LIMITS.resultId) && Number.isFinite(n))
    if (key && clean.length) s.learned[key.slice(0, CACHE_LIMITS.learnedKeyLength)] = Object.fromEntries(clean)
  }
  return s
}

export function snapshotStats(s: SearchCacheSnapshot): SearchCacheStats {
  let entries = Object.keys(s.usage).length
  for (const dbs of Object.values(s.tables)) for (const tables of Object.values(dbs)) entries += tables.length
  for (const server of Object.values(s.servers)) entries += server.sites.length + server.services.length
  for (const paths of Object.values(s.paths)) entries += paths.length
  return { entries, bytes: JSON.stringify(s).length }
}
