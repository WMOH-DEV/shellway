import type { PersistedHistoryEntry } from '@/types/sql'
import { sendIntent } from '../intentStore'
import { buildCollection, memoIndex, searchCollection } from '../miniIndex'
import { recencyFromTimestamp } from '../ranking'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { collapseWhitespace, copyText, createTtlCache, formatRelative, MAX_RESULTS, truncate, uniqueScopeIds } from './shared'

const CACHE_TTL_MS = 30_000
const HISTORY_LIMIT = 200
const TITLE_MAX = 120
const KEYWORDS_MAX = 400
const EMPTY_QUERY_LIMIT = 5
const CREDENTIAL_STATEMENT = /IDENTIFIED\s+(WITH\s+\S+\s+)?BY|\bPASSWORD\s*(\(|=|FOR\b|')/i

interface HistoryEntry {
  id: string
  scopeId: string
  line: string
  sql: string
  database: string
  executedAt: number
  rowCount: number | undefined
}

async function loadHistory(scopeId: string): Promise<PersistedHistoryEntry[]> {
  try {
    const result = (await window.novadeck.sql.historyList(scopeId, { limit: HISTORY_LIMIT, source: 'user' })) as
      | { entries?: PersistedHistoryEntry[] }
      | undefined
    return result?.entries ?? []
  } catch {
    return []
  }
}

function toEntries(scopeId: string, entries: PersistedHistoryEntry[]): HistoryEntry[] {
  return entries
    .filter((entry) => !CREDENTIAL_STATEMENT.test(entry.query))
    .map((entry) => ({
      id: `history:${scopeId}:${entry.id}`,
      scopeId,
      line: collapseWhitespace(entry.query),
      sql: entry.query,
      database: entry.database,
      executedAt: entry.executedAt,
      rowCount: entry.rowCount
    }))
}

function subtitleOf(entry: HistoryEntry, now: number): string {
  const parts = [`ran ${formatRelative(entry.executedAt, now)}`]
  if (entry.rowCount !== undefined) parts.push(`${entry.rowCount} rows`)
  if (entry.database) parts.push(entry.database)
  return parts.join(' · ')
}

function toResult(entry: HistoryEntry, now: number): SearchResult {
  return {
    id: entry.id,
    providerId: 'history',
    title: truncate(entry.line, TITLE_MAX),
    subtitle: subtitleOf(entry, now),
    icon: 'history',
    keywords: entry.line.slice(0, KEYWORDS_MAX),
    scoreHints: { recency: recencyFromTimestamp(entry.executedAt, now) },
    payload: { scopeId: entry.scopeId, sql: entry.sql, database: entry.database }
  }
}

export function createHistoryProvider(): SearchProvider {
  const historyFor = createTtlCache(CACHE_TTL_MS, loadHistory)

  async function newestOfActiveSession(query: SearchQuery): Promise<HistoryEntry[]> {
    const scopeId = query.context.activeSessionId
    if (!scopeId) return []
    const loaded = await historyFor(scopeId)
    return toEntries(scopeId, loaded)
      .sort((a, b) => b.executedAt - a.executedAt)
      .slice(0, EMPTY_QUERY_LIMIT)
  }

  async function matching(query: SearchQuery): Promise<HistoryEntry[]> {
    const scopes = uniqueScopeIds()
    const loaded = await Promise.all(scopes.map((scopeId) => historyFor(scopeId)))
    const collection = memoIndex('history', [scopes.join('\n'), ...loaded], () =>
      buildCollection(
        scopes.flatMap((scopeId, i) => toEntries(scopeId, loaded[i])),
        ['line']
      )
    )
    return searchCollection(collection, query.text, MAX_RESULTS)
  }

  async function* search(query: SearchQuery, signal: AbortSignal): AsyncGenerator<SearchResult[]> {
    if (signal.aborted) return
    const entries = query.text ? await matching(query) : await newestOfActiveSession(query)
    if (signal.aborted) return
    const now = Date.now()
    yield entries.slice(0, MAX_RESULTS).map((entry) => toResult(entry, now))
  }

  return {
    id: 'history',
    kind: 'local',
    scopes: ['history'],
    search,
    actions(result): SearchAction[] {
      const { scopeId, sql, database } = result.payload as { scopeId: string; sql: string; database: string }
      return [
        {
          id: 'open-query-tab',
          label: 'Open in new query tab',
          role: 'primary',
          run: () => sendIntent(scopeId, { kind: 'open-sql', sql, title: 'History query', database: database || undefined })
        },
        { id: 'copy', label: 'Copy', role: 'copy', run: () => copyText(sql) }
      ]
    }
  }
}
