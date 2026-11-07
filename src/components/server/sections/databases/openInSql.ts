import { toast } from '@/components/ui/Toast'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSQLStore } from '@/stores/sqlStore'
import type { PendingDatabase, SQLConnectionSlice } from '@/stores/sqlStore'
import type { DbEngine } from '@/utils/server/databases/types'

function showSqlTab(tabId: string): void {
  const { tabs, updateTab } = useConnectionStore.getState()
  const tab = tabs.find((candidate) => candidate.id === tabId)
  if (!tab) return
  const running = tab.runningSubTabs
  updateTab(tabId, running && !running.includes('sql') ? { activeSubTab: 'sql', runningSubTabs: [...running, 'sql'] } : { activeSubTab: 'sql' })
}

async function switchDatabase(tabId: string, sessionId: string, database: string): Promise<boolean> {
  const result = await window.novadeck.sql.switchDatabase(sessionId, database).catch(() => null)
  if (!result?.success) return false
  useSQLStore.getState().setCurrentDatabase(tabId, database)
  return true
}

const PENDING_LIFETIME_MS = 10 * 60 * 1000

const OTHER_ENGINE = 'The SQL tab is connected to a different kind of database.'

function sqlType(engine: DbEngine): 'mysql' | 'postgres' {
  return engine === 'mysql' ? 'mysql' : 'postgres'
}

function sameEngineSessionId(connection: SQLConnectionSlice | undefined, type: PendingDatabase['engine']): string | null {
  if (connection?.connectionStatus !== 'connected') return null
  return connection.connectionConfig?.type === type ? connection.sqlSessionId : null
}

function hasNewSession(connection: SQLConnectionSlice | undefined, pending: PendingDatabase): boolean {
  if (connection?.connectionStatus !== 'connected' || !connection.connectionConfig) return false
  return !!connection.sqlSessionId && connection.sqlSessionId !== pending.staleSessionId
}

function toastPickManually(database: string, hint?: string): void {
  toast.info(`Pick ${database} in the SQL tab`, hint)
}

async function applyPendingDatabase(tabId: string, pending: PendingDatabase): Promise<void> {
  const sessionId = sameEngineSessionId(useSQLStore.getState().connections[tabId], pending.engine)
  if (!sessionId) return toastPickManually(pending.database, OTHER_ENGINE)
  if (pending.engine !== 'mysql') return toastPickManually(pending.database)
  if (await switchDatabase(tabId, sessionId, pending.database)) return
  toast.error(`Could not open ${pending.database}`, 'Pick it in the SQL tab.')
}

function applyReadyPendingDatabases(): void {
  const { pendingDatabases, connections, setPendingDatabase } = useSQLStore.getState()
  for (const [tabId, pending] of Object.entries(pendingDatabases)) {
    const expired = Date.now() > pending.expiresAt
    if (!expired && !hasNewSession(connections[tabId], pending)) continue
    setPendingDatabase(tabId, null)
    if (!expired) void applyPendingDatabase(tabId, pending)
  }
}

useSQLStore.subscribe(applyReadyPendingDatabases)

export async function openInSqlTab(tabId: string, engine: DbEngine, database: string): Promise<void> {
  showSqlTab(tabId)
  const connection = useSQLStore.getState().connections[tabId]
  const sessionId = sameEngineSessionId(connection, sqlType(engine))
  if (sessionId && engine === 'mysql' && (await switchDatabase(tabId, sessionId, database))) return
  if (sessionId) return toastPickManually(database)
  if (connection?.connectionStatus === 'connected') return toastPickManually(database, OTHER_ENGINE)
  const staleSessionId = connection?.sqlSessionId ?? null
  useSQLStore.getState().setPendingDatabase(tabId, { engine: sqlType(engine), database, staleSessionId, expiresAt: Date.now() + PENDING_LIFETIME_MS })
  toast.info(`Connect to the database server, then Shellway opens ${database}.`)
}
