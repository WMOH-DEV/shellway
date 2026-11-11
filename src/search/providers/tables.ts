import { useConnectionStore } from '@/stores/connectionStore'
import { useSQLStore } from '@/stores/sqlStore'
import type { CachedTable } from '@/types/search'
import type { SchemaColumn, SchemaTable } from '@/types/sql'
import { useSearchCacheStore } from '../cacheClient'
import { sendIntent } from '../intentStore'
import { buildCollection, memoIndex, searchCollection, type Collection } from '../miniIndex'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { copyText, isScopeConnected, localSearch, MAX_RESULTS, scopeName } from './shared'

const EMPTY_QUERY_LIMIT = 8
const INDEXED_FIELDS = ['name', 'path']

interface TableEntry {
  id: string
  scopeId: string
  database: string
  table: string
  column: string | null
  type: 'table' | 'view'
  name: string
  path: string
}

interface TableSource {
  scopeId: string
  database: string
  tables: CachedTable[]
}

export function toCachedTables(tables: SchemaTable[], columns: SchemaColumn[]): CachedTable[] {
  const columnsByTable = new Map<string, string[]>()
  for (const column of columns) {
    if (!column.tableName) continue
    columnsByTable.set(column.tableName, [...(columnsByTable.get(column.tableName) ?? []), column.name])
  }
  return tables.map((t) => ({ name: t.name, type: t.type, columns: columnsByTable.get(t.name) ?? [] }))
}

function liveSources(): TableSource[] {
  const { connections } = useSQLStore.getState()
  const sources: TableSource[] = []
  for (const tab of useConnectionStore.getState().tabs) {
    const slice = connections[tab.id]
    if (!slice?.currentDatabase || slice.tables.length === 0) continue
    sources.push({ scopeId: tab.sessionId, database: slice.currentDatabase, tables: toCachedTables(slice.tables, slice.columns) })
  }
  return sources
}

function cachedSources(covered: Set<string>): TableSource[] {
  const cached = useSearchCacheStore.getState().snapshot?.tables ?? {}
  return Object.entries(cached).flatMap(([scopeId, databases]) =>
    Object.entries(databases)
      .filter(([database]) => !covered.has(`${scopeId}\n${database}`))
      .map(([database, tables]) => ({ scopeId, database, tables }))
  )
}

function entriesOf(source: TableSource): TableEntry[] {
  const { scopeId, database } = source
  return source.tables.flatMap((table) => {
    const tableEntry: TableEntry = {
      id: `table:${scopeId}:${database}:${table.name}`,
      scopeId,
      database,
      table: table.name,
      column: null,
      type: table.type,
      name: table.name,
      path: table.name
    }
    const columnEntries = table.columns.map<TableEntry>((column) => ({
      id: `column:${scopeId}:${database}:${table.name}.${column}`,
      scopeId,
      database,
      table: table.name,
      column,
      type: table.type,
      name: column,
      path: `${table.name}.${column}`
    }))
    return [tableEntry, ...columnEntries]
  })
}

function buildEntries(): TableEntry[] {
  const live = liveSources()
  const covered = new Set(live.map((s) => `${s.scopeId}\n${s.database}`))
  return [...live, ...cachedSources(covered)].flatMap(entriesOf)
}

function currentCollection(): Collection<TableEntry> {
  const { connections } = useSQLStore.getState()
  const liveDeps = useConnectionStore
    .getState()
    .tabs.flatMap((tab) => [tab.sessionId, connections[tab.id]?.currentDatabase, connections[tab.id]?.tables, connections[tab.id]?.columns])
  const cached = useSearchCacheStore.getState().snapshot?.tables
  return memoIndex('tables', [cached, ...liveDeps], () => buildCollection(buildEntries(), INDEXED_FIELDS))
}

const COLUMN_WEIGHT = 0.75

function contextHint(entry: TableEntry, query: SearchQuery): number {
  if (entry.scopeId !== query.context.activeSessionId) return 0
  return entry.database === query.context.activeDatabase ? 1 : 0.5
}

function toResult(entry: TableEntry, query: SearchQuery): SearchResult {
  const connected = isScopeConnected(entry.scopeId)
  const isColumn = entry.column !== null
  const subtitle = isColumn
    ? `column · ${entry.table} · ${entry.database}`
    : `${entry.type} · ${entry.database} · ${scopeName(entry.scopeId)}`
  return {
    id: entry.id,
    providerId: 'tables',
    title: entry.name,
    subtitle,
    icon: isColumn ? 'column' : 'table',
    hint: connected ? undefined : 'disconnected',
    keywords: isColumn ? entry.path : undefined,
    scoreHints: { context: contextHint(entry, query), disconnected: !connected, weight: isColumn ? COLUMN_WEIGHT : 1 },
    payload: { scopeId: entry.scopeId, database: entry.database, table: entry.table, column: entry.column }
  }
}

function activeDatabaseTables(collection: Collection<TableEntry>, query: SearchQuery): TableEntry[] {
  const { activeSessionId, activeDatabase } = query.context
  if (!activeSessionId || !activeDatabase) return []
  const found: TableEntry[] = []
  for (const entry of collection.byId.values()) {
    if (entry.column === null && entry.scopeId === activeSessionId && entry.database === activeDatabase) found.push(entry)
    if (found.length === EMPTY_QUERY_LIMIT) break
  }
  return found
}

function compute(query: SearchQuery): SearchResult[] {
  const collection = currentCollection()
  const entries = query.text ? searchCollection(collection, query.text, MAX_RESULTS) : activeDatabaseTables(collection, query)
  return entries.map((entry) => toResult(entry, query))
}

interface TablePayload {
  scopeId: string
  database: string
  table: string
}

function openTable({ scopeId, database, table }: TablePayload, newTab: boolean): void {
  sendIntent(scopeId, { kind: 'open-table', database, table, newTab })
}

export function createTablesProvider(): SearchProvider {
  return {
    id: 'tables',
    kind: 'local',
    scopes: ['tables'],
    search: localSearch(compute),
    actions(result): SearchAction[] {
      const payload = result.payload as TablePayload
      return [
        { id: 'open', label: 'Open', role: 'primary', run: () => openTable(payload, false) },
        { id: 'open-new-tab', label: 'Open in new tab', role: 'secondary', run: () => openTable(payload, true) },
        { id: 'copy-name', label: 'Copy name', role: 'copy', run: () => copyText(result.title) }
      ]
    }
  }
}
