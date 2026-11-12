import { useCallback, useEffect, useRef, useState } from 'react'
import { SQL_INTENTS, useSearchIntentStore, type SearchIntent, type SqlIntentAction } from '@/search/intentStore'
import { getSQLConnectionState } from '@/stores/sqlStore'
import type { DatabaseContextAction } from './SchemaSidebar'

interface SqlSearchIntentOptions {
  sessionId: string
  connectionId: string
  ready: boolean
  canConnect: boolean
  connect: () => void
  currentDatabase: string | null
  switchDatabase: (database: string) => Promise<void>
  openTable: (table: string, newTab: boolean) => void
  openQuery: (sql: string, title: string) => void
  newQuery: () => void
  refresh: () => void
  databaseAction: (action: DatabaseContextAction) => void
}

const DATABASE_ACTIONS: Partial<Record<SqlIntentAction, DatabaseContextAction>> = {
  export: { type: 'export-database' },
  import: { type: 'import-sql' },
  backup: { type: 'backup' },
  restore: { type: 'restore' },
  'create-table': { type: 'create-table' }
}

function targetDatabase(intent: SearchIntent): string | null {
  if (intent.kind === 'open-table') return intent.database
  if (intent.kind === 'open-sql') return intent.database ?? null
  return null
}

export function useSqlSearchIntents(options: SqlSearchIntentOptions): void {
  const { sessionId, connectionId, ready, canConnect, currentDatabase, switchDatabase } = options
  const pending = useSearchIntentStore((s) => s.pending[sessionId])
  const [queue, setQueue] = useState<SearchIntent[]>([])
  const switchingTo = useRef<string | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const connectRequested = !!pending?.some((i) => i.kind === 'sql-connect')

  useEffect(() => {
    if (!connectRequested || !canConnect) return
    useSearchIntentStore.getState().take(sessionId, ['sql-connect'])
    optionsRef.current.connect()
  }, [connectRequested, canConnect, sessionId])

  useEffect(() => {
    if (!ready || !pending?.some((i) => SQL_INTENTS.includes(i.kind))) return
    const taken = useSearchIntentStore.getState().take(sessionId, SQL_INTENTS)
    if (taken.length > 0) setQueue((q) => [...q, ...taken])
  }, [ready, pending, sessionId])

  const dropHead = useCallback(() => setQueue((q) => q.slice(1)), [])

  useEffect(() => {
    const [head] = queue
    if (!head) return
    const database = targetDatabase(head)
    if (database && database !== currentDatabase) {
      if (switchingTo.current === database) return
      switchingTo.current = database
      void switchDatabase(database).catch(() => undefined).then(() => {
        switchingTo.current = null
        if (getSQLConnectionState(connectionId).currentDatabase !== database) dropHead()
      })
      return
    }
    run(head, optionsRef.current)
    dropHead()
  }, [queue, currentDatabase, connectionId, switchDatabase, dropHead])
}

function run(intent: SearchIntent, o: SqlSearchIntentOptions): void {
  switch (intent.kind) {
    case 'open-table':
      o.openTable(intent.table, intent.newTab)
      return
    case 'open-sql':
      o.openQuery(intent.sql, intent.title)
      return
    case 'sql-action':
      runAction(intent.action, o)
      return
    default:
      return
  }
}

function runAction(action: SqlIntentAction, o: SqlSearchIntentOptions): void {
  if (action === 'refresh') o.refresh()
  else if (action === 'new-query') o.newQuery()
  else {
    const databaseAction = DATABASE_ACTIONS[action]
    if (databaseAction) o.databaseAction(databaseAction)
  }
}
