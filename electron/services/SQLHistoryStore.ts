import Store from 'electron-store'

export type HistorySource = 'user' | 'data'

export interface PersistedHistoryEntry {
  id: string
  query: string
  database: string
  source: HistorySource
  executedAt: number
  executionTimeMs: number
  rowCount?: number
  error?: string
  isFavorite: boolean
}

export interface HistoryFilter {
  search?: string
  source?: HistorySource | 'all'
  database?: string
  favoritesOnly?: boolean
  errorsOnly?: boolean
  limit?: number
  offset?: number
}

interface StoreSchema {
  entries: Record<string, PersistedHistoryEntry[]>
}

/** Editor queries are the ones users come back to, so they get the larger budget. */
const MAX_USER_ENTRIES = 3000
const MAX_DATA_ENTRIES = 1000
const FLUSH_DELAY_MS = 2000
const DEFAULT_PAGE_SIZE = 200

/** Render `?` / `$N` placeholders so stored history shows the values that actually ran. */
export function interpolateParams(query: string, params?: unknown[]): string {
  if (!params || params.length === 0) return query
  let index = 0
  return query.replace(/\?|\$\d+/g, (match) => {
    const position = match === '?' ? index++ : Number.parseInt(match.slice(1), 10) - 1
    const value = params[position]
    if (value === null || value === undefined) return 'NULL'
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    return `'${String(value).replace(/'/g, "''")}'`
  })
}

/**
 * Persistent per-connection query history.
 *
 * Writes are buffered: a busy data tab can emit dozens of queries a second and
 * electron-store rewrites the whole file on every `set`.
 */
export class SQLHistoryStore {
  private store: Store<StoreSchema>
  private cache: Record<string, PersistedHistoryEntry[]> | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private dirty = false

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'sql-history',
      defaults: { entries: {} }
    })
  }

  private data(): Record<string, PersistedHistoryEntry[]> {
    if (!this.cache) this.cache = this.store.get('entries', {})
    return this.cache
  }

  private markDirty(): void {
    this.dirty = true
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, FLUSH_DELAY_MS)
  }

  private trim(list: PersistedHistoryEntry[]): PersistedHistoryEntry[] {
    const favorites = list.filter((entry) => entry.isFavorite)
    const users = list
      .filter((entry) => !entry.isFavorite && entry.source === 'user')
      .slice(0, MAX_USER_ENTRIES)
    const data = list
      .filter((entry) => !entry.isFavorite && entry.source === 'data')
      .slice(0, MAX_DATA_ENTRIES)
    return [...favorites, ...users, ...data].sort(
      (a, b) => b.executedAt - a.executedAt
    )
  }

  flush(): void {
    if (!this.dirty || !this.cache) return
    this.store.set('entries', this.cache)
    this.dirty = false
  }

  add(scopeId: string, entry: PersistedHistoryEntry): void {
    if (!scopeId) return
    const all = this.data()
    const list = all[scopeId] ?? []
    list.unshift(entry)
    all[scopeId] =
      list.length > MAX_USER_ENTRIES + MAX_DATA_ENTRIES ? this.trim(list) : list
    this.markDirty()
  }

  list(
    scopeId: string,
    filter: HistoryFilter = {}
  ): { entries: PersistedHistoryEntry[]; total: number } {
    const list = this.data()[scopeId] ?? []
    const search = filter.search?.trim().toLowerCase()

    const matched = list.filter((entry) => {
      if (filter.favoritesOnly && !entry.isFavorite) return false
      if (filter.errorsOnly && !entry.error) return false
      if (filter.source && filter.source !== 'all' && entry.source !== filter.source) {
        return false
      }
      if (filter.database && entry.database !== filter.database) return false
      if (search && !entry.query.toLowerCase().includes(search)) return false
      return true
    })

    const offset = filter.offset ?? 0
    const limit = filter.limit ?? DEFAULT_PAGE_SIZE
    return {
      entries: matched.slice(offset, offset + limit),
      total: matched.length
    }
  }

  toggleFavorite(scopeId: string, id: string): boolean {
    const list = this.data()[scopeId]
    if (!list) return false
    const entry = list.find((item) => item.id === id)
    if (!entry) return false
    entry.isFavorite = !entry.isFavorite
    this.markDirty()
    return true
  }

  remove(scopeId: string, ids: string[]): boolean {
    const all = this.data()
    const list = all[scopeId]
    if (!list) return false
    const doomed = new Set(ids)
    all[scopeId] = list.filter((entry) => !doomed.has(entry.id))
    this.markDirty()
    return true
  }

  clear(scopeId: string, keepFavorites: boolean): boolean {
    const all = this.data()
    if (!all[scopeId]) return false
    all[scopeId] = keepFavorites
      ? all[scopeId].filter((entry) => entry.isFavorite)
      : []
    this.markDirty()
    return true
  }

  databases(scopeId: string): string[] {
    const list = this.data()[scopeId] ?? []
    const names = new Set<string>()
    for (const entry of list) {
      if (entry.database) names.add(entry.database)
    }
    return Array.from(names).sort()
  }

  /** Drop everything for one connection — called when its saved config is deleted. */
  dropScope(scopeId: string): void {
    const all = this.data()
    if (!(scopeId in all)) return
    delete all[scopeId]
    this.markDirty()
  }
}
