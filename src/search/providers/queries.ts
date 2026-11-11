import type { SavedQuery } from '@/types/sql'
import { sendIntent } from '../intentStore'
import { buildCollection, memoIndex, searchCollection } from '../miniIndex'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { copyText, createTtlCache, MAX_RESULTS, scopeName, uniqueScopeIds } from './shared'

const CACHE_TTL_MS = 30_000

interface QueryEntry {
  id: string
  scopeId: string
  name: string
  sql: string
}

async function loadQueries(scopeId: string): Promise<SavedQuery[]> {
  try {
    return ((await window.novadeck.sql.queriesList(scopeId)) as SavedQuery[] | undefined) ?? []
  } catch {
    return []
  }
}

function toEntry(scopeId: string, query: SavedQuery): QueryEntry {
  return { id: `query:${scopeId}:${query.id}`, scopeId, name: query.name, sql: query.sql }
}

function toResult(entry: QueryEntry): SearchResult {
  return {
    id: entry.id,
    providerId: 'queries',
    title: entry.name,
    subtitle: `saved query · ${scopeName(entry.scopeId)}`,
    icon: 'query',
    scoreHints: {},
    payload: { scopeId: entry.scopeId, name: entry.name, sql: entry.sql }
  }
}

export function createQueriesProvider(): SearchProvider {
  const queriesFor = createTtlCache(CACHE_TTL_MS, loadQueries)

  async function* search(query: SearchQuery, signal: AbortSignal): AsyncGenerator<SearchResult[]> {
    if (!query.text || signal.aborted) return
    const scopes = uniqueScopeIds()
    const loaded = await Promise.all(scopes.map((scopeId) => queriesFor(scopeId)))
    if (signal.aborted) return
    const collection = memoIndex('queries', [scopes.join('\n'), ...loaded], () =>
      buildCollection(
        scopes.flatMap((scopeId, i) => loaded[i].map((q) => toEntry(scopeId, q))),
        ['name']
      )
    )
    yield searchCollection(collection, query.text, MAX_RESULTS).map(toResult)
  }

  return {
    id: 'queries',
    kind: 'local',
    scopes: ['queries'],
    search,
    actions(result): SearchAction[] {
      const { scopeId, name, sql } = result.payload as { scopeId: string; name: string; sql: string }
      return [
        { id: 'open', label: 'Open', role: 'primary', run: () => sendIntent(scopeId, { kind: 'open-sql', sql, title: name }) },
        { id: 'copy-sql', label: 'Copy SQL', role: 'copy', run: () => copyText(sql) }
      ]
    }
  }
}
