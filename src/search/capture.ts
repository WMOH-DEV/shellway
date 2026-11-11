import { useConnectionStore } from '@/stores/connectionStore'
import { useServerFactsStore } from '@/stores/serverFactsStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSQLStore } from '@/stores/sqlStore'
import type { SearchCachePatch } from '@/types/search'
import { applySearchCachePatch } from './cacheClient'
import { snapshotFromFacts } from './providers/serverEntities'
import { toCachedTables } from './providers/tables'

const DEBOUNCE_MS = 500
const MAX_LISTING_PATHS = 500

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const lastSent = new Map<string, string>()
let stopCapture: (() => void) | null = null

function sendIfChanged(key: string, patch: SearchCachePatch): void {
  const serialized = JSON.stringify(patch)
  if (lastSent.get(key) === serialized) return
  lastSent.set(key, serialized)
  applySearchCachePatch(patch)
}

function debounced(key: string, task: () => void): void {
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key)
      task()
    }, DEBOUNCE_MS)
  )
}

function captureTables(connectionId: string): void {
  const tab = useConnectionStore.getState().tabs.find((t) => t.id === connectionId)
  const slice = useSQLStore.getState().connections[connectionId]
  if (!tab || !slice?.currentDatabase || slice.tables.length === 0) return
  const { sessionId } = tab
  const database = slice.currentDatabase
  sendIfChanged(`tables:${sessionId}:${database}`, {
    kind: 'tables',
    scopeId: sessionId,
    database,
    tables: toCachedTables(slice.tables, slice.columns)
  })
}

function captureServer(connectionId: string): void {
  const tab = useConnectionStore.getState().tabs.find((t) => t.id === connectionId)
  const facts = useServerFactsStore.getState().byConnection[connectionId]
  if (!tab || !facts) return
  const { sites, services } = snapshotFromFacts(tab.sessionId, facts)
  if (sites.length === 0 && services.length === 0) return
  sendIfChanged(`server:${tab.sessionId}`, { kind: 'server', scopeId: tab.sessionId, sites, services })
}

function watchSql(): () => void {
  return useSQLStore.subscribe((state, previous) => {
    for (const [connectionId, slice] of Object.entries(state.connections)) {
      const before = previous.connections[connectionId]
      if (slice.tables !== before?.tables || slice.columns !== before?.columns) {
        debounced(`tables:${connectionId}`, () => captureTables(connectionId))
      }
    }
  })
}

function watchFacts(): () => void {
  return useServerFactsStore.subscribe((state, previous) => {
    for (const [connectionId, facts] of Object.entries(state.byConnection)) {
      if (facts !== previous.byConnection[connectionId]) debounced(`server:${connectionId}`, () => captureServer(connectionId))
    }
  })
}

function forgetSession(sessionId: string): void {
  for (const key of [...lastSent.keys()]) {
    if (key.includes(`:${sessionId}`)) lastSent.delete(key)
  }
  applySearchCachePatch({ kind: 'forget', scopeId: sessionId })
}

function watchSessions(): () => void {
  return useSessionStore.subscribe((state, previous) => {
    const remaining = new Set(state.sessions.map((s) => s.id))
    for (const session of previous.sessions) {
      if (!remaining.has(session.id)) forgetSession(session.id)
    }
  })
}

export function startSearchCapture(): () => void {
  if (stopCapture) return stopCapture
  const stops = [watchSql(), watchFacts(), watchSessions()]
  stopCapture = () => {
    stops.forEach((stop) => stop())
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
    lastSent.clear()
    stopCapture = null
  }
  return stopCapture
}

interface ListedEntry {
  path: string
  isDirectory: boolean
}

export function captureListing(sessionId: string, path: string, entries: ListedEntry[]): void {
  const listed = entries.map((entry) => (entry.isDirectory && !entry.path.endsWith('/') ? `${entry.path}/` : entry.path))
  const own = path.length > 1 ? [path.endsWith('/') ? path : `${path}/`] : []
  applySearchCachePatch({ kind: 'paths', scopeId: sessionId, paths: [...own, ...listed].slice(0, MAX_LISTING_PATHS) })
}
