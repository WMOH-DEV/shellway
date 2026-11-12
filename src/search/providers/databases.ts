import { savedDatabaseLabel, useSavedDatabaseStore } from '@/stores/savedDatabaseStore'
import type { SavedDatabase } from '@/types/sql'
import { openSavedDatabase } from '../intentStore'
import { buildCollection, memoIndex, searchCollection } from '../miniIndex'
import { recencyFromTimestamp } from '../ranking'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { copyText, localSearch, MAX_RESULTS, tabHint } from './shared'

const SUGGESTION_COUNT = 5
const INDEXED_FIELDS = ['name', 'host', 'database', 'engine', 'tag']

const ENGINE_NAMES: Record<SavedDatabase['type'], string> = { mysql: 'MySQL', postgres: 'PostgreSQL' }

interface DatabaseEntry {
  id: string
  sessionId: string
  name: string
  host: string
  port: number
  database: string
  engine: string
  tag: string
  lastUsed: number | undefined
}

function toEntry(db: SavedDatabase): DatabaseEntry {
  return {
    id: db.sessionId,
    sessionId: db.sessionId,
    name: savedDatabaseLabel(db),
    host: db.host,
    port: db.port,
    database: db.database,
    engine: ENGINE_NAMES[db.type],
    tag: db.tag && db.tag !== 'none' ? db.tag : '',
    lastUsed: db.lastUsed
  }
}

function toResult(entry: DatabaseEntry, now: number): SearchResult {
  const subtitle = [entry.engine, `${entry.host}:${entry.port}`, entry.database, entry.tag].filter(Boolean).join(' · ')
  return {
    id: `database:${entry.sessionId}`,
    providerId: 'databases',
    title: entry.name,
    subtitle,
    icon: 'database',
    hint: tabHint(entry.sessionId),
    keywords: `${entry.host} ${entry.database} ${entry.engine} ${entry.tag}`,
    scoreHints: { recency: recencyFromTimestamp(entry.lastUsed, now) },
    payload: { sessionId: entry.sessionId, host: entry.host }
  }
}

function recentlyUsed(entries: DatabaseEntry[]): DatabaseEntry[] {
  return entries
    .filter((entry) => entry.lastUsed)
    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
    .slice(0, SUGGESTION_COUNT)
}

function compute(query: SearchQuery): SearchResult[] {
  const databases = useSavedDatabaseStore.getState().databases
  const now = Date.now()
  const collection = memoIndex('databases', [databases], () => buildCollection(databases.map(toEntry), INDEXED_FIELDS))
  const entries = query.text ? searchCollection(collection, query.text, MAX_RESULTS) : recentlyUsed([...collection.byId.values()])
  return entries.map((entry) => toResult(entry, now))
}

export function createDatabasesProvider(): SearchProvider {
  return {
    id: 'databases',
    kind: 'local',
    scopes: ['servers'],
    search: localSearch(compute),
    actions(result): SearchAction[] {
      const { sessionId, host } = result.payload as { sessionId: string; host: string }
      return [
        { id: 'open', label: 'Connect', role: 'primary', run: () => void openSavedDatabase(sessionId) },
        { id: 'copy-host', label: 'Copy host', role: 'copy', run: () => copyText(host) }
      ]
    }
  }
}
