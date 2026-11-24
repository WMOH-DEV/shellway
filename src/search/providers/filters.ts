import type { CachedTable } from '@/types/search'
import { describeFilter } from '@/components/sql/tabs/dataTabSummary'
import type { FilterMatch, FilterSpec, TableFilterRequest } from '@/types/sql'
import { NO_VALUE_OPERATORS } from '@/utils/sqlFilterBuilder'
import { sendIntent } from '../intentStore'
import { recencyFromTimestamp, textMatch } from '../ranking'
import { useRecentFiltersStore, type RecentFilter } from '../recentFilters'
import { parseTableCommand, type TableCommand } from '../tableCommand'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { contextHint, tableSources } from './tables'
import { copyText, isScopeConnected, localSearch, scopeName } from './shared'

const MAX_COLUMNS = 8
const EMPTY_QUERY_RECENTS = 5

interface FilterTarget {
  scopeId: string
  database: string
  table: CachedTable
}

interface FilterPayload {
  scopeId: string
  database: string
  table: string
  request: TableFilterRequest
}

function describeFilters(filters: FilterSpec[], match: FilterMatch): string {
  return filters.map(describeFilter).join(match === 'all' ? ' and ' : ' or ')
}

function targetsNamed(name: string): FilterTarget[] {
  const wanted = name.toLowerCase()
  return tableSources().flatMap(({ scopeId, database, tables }) =>
    tables.filter((table) => table.name.toLowerCase() === wanted).map((table) => ({ scopeId, database, table }))
  )
}

function matchingColumns(columns: string[], fragment: string): string[] {
  const wanted = fragment.toLowerCase()
  const lower = (column: string) => column.toLowerCase()
  const exact = columns.filter((c) => lower(c) === wanted)
  const prefix = columns.filter((c) => lower(c) !== wanted && lower(c).startsWith(wanted))
  const inside = columns.filter((c) => !lower(c).startsWith(wanted) && lower(c).includes(wanted))
  return [...exact, ...prefix, ...inside]
}

function isListing(command: Extract<TableCommand, { kind: 'filter' }>): boolean {
  return command.operator === 'contains' && command.value === ''
}

function columnsFor(target: FilterTarget, command: Extract<TableCommand, { kind: 'filter' }>): string[] {
  const known = target.table.columns
  if (!command.column && !isListing(command)) return []
  if (known.length === 0) return command.column ? [command.column] : []
  const found = matchingColumns(known, command.column)
  return isListing(command) ? found.slice(0, MAX_COLUMNS) : found.slice(0, 1)
}

function subtitleFor(kind: string, target: { scopeId: string; database: string }): string {
  return `${kind} · ${target.database} · ${scopeName(target.scopeId)}`
}

function result(
  id: string,
  title: string,
  subtitle: string,
  payload: FilterPayload,
  query: SearchQuery,
  hints: { exact?: boolean; weight?: number; recency?: number } = {}
): SearchResult {
  const connected = isScopeConnected(payload.scopeId)
  return {
    id,
    providerId: 'filters',
    title,
    subtitle,
    icon: 'filter',
    hint: connected ? undefined : 'disconnected',
    scoreHints: { ...hints, context: contextHint(payload, query), disconnected: !connected },
    payload
  }
}

function columnResults(target: FilterTarget, command: Extract<TableCommand, { kind: 'filter' }>, query: SearchQuery): SearchResult[] {
  const { scopeId, database } = target
  const table = target.table.name
  return columnsFor(target, command).map((column, index) => {
    const spec: FilterSpec = { column, operator: command.operator, value: command.value }
    const ready = NO_VALUE_OPERATORS.has(spec.operator) || spec.value !== ''
    const title = ready ? `${table} where ${describeFilter(spec)}` : `Filter ${table} by ${column}`
    const payload: FilterPayload = { scopeId, database, table, request: { kind: 'filters', filters: [spec] } }
    const id = `filter:${scopeId}:${database}:${table}.${column}:${spec.operator}:${spec.value}`
    return result(id, title, subtitleFor(ready ? 'filter' : 'type the value in the table', target), payload, query, { exact: true, weight: 1 - index * 0.01 })
  })
}

function rowResult(target: FilterTarget, value: string, query: SearchQuery): SearchResult {
  const { scopeId, database } = target
  const table = target.table.name
  const payload: FilterPayload = { scopeId, database, table, request: { kind: 'row', value } }
  return result(`row:${scopeId}:${database}:${table}:${value}`, `${table} row ${value}`, subtitleFor('by primary key', target), payload, query, { exact: true })
}

function commandResults(command: TableCommand, query: SearchQuery): SearchResult[] {
  const targets = targetsNamed(command.table)
  if (command.kind === 'row') return targets.map((target) => rowResult(target, command.value, query))
  return targets.flatMap((target) => columnResults(target, command, query))
}

function recentTitle(entry: RecentFilter): string {
  return `${entry.table} where ${describeFilters(entry.filters, entry.match)}`
}

function recentResult(entry: RecentFilter, query: SearchQuery): SearchResult {
  const { scopeId, database, table, filters, match } = entry
  const payload: FilterPayload = { scopeId, database, table, request: { kind: 'filters', filters, match } }
  const id = `recent-filter:${scopeId}:${database}:${table}:${JSON.stringify(filters)}:${match}`
  return result(id, recentTitle(entry), subtitleFor('recent filter', entry), payload, query, { recency: recencyFromTimestamp(entry.at, Date.now()) })
}

function recentResults(query: SearchQuery): SearchResult[] {
  const { entries } = useRecentFiltersStore.getState()
  if (!query.text) {
    const { activeSessionId, activeDatabase } = query.context
    return entries
      .filter((e) => e.scopeId === activeSessionId && e.database === activeDatabase)
      .slice(0, EMPTY_QUERY_RECENTS)
      .map((e) => recentResult(e, query))
  }
  return entries.filter((e) => textMatch(recentTitle(e), query.text) > 0).map((e) => recentResult(e, query))
}

function compute(query: SearchQuery): SearchResult[] {
  const command = parseTableCommand(query.text)
  return command ? commandResults(command, query) : recentResults(query)
}

function open({ scopeId, database, table, request }: FilterPayload, newTab: boolean): void {
  sendIntent(scopeId, { kind: 'open-table', database, table, newTab, filter: request })
}

export function createFiltersProvider(): SearchProvider {
  return {
    id: 'filters',
    kind: 'local',
    scopes: ['tables'],
    search: localSearch(compute),
    actions(found): SearchAction[] {
      const payload = found.payload as FilterPayload
      return [
        { id: 'open', label: 'Open', role: 'primary', run: () => open(payload, false) },
        { id: 'open-new-tab', label: 'Open in new tab', role: 'secondary', run: () => open(payload, true) },
        { id: 'copy-name', label: 'Copy', role: 'copy', run: () => copyText(found.title) }
      ]
    }
  }
}
