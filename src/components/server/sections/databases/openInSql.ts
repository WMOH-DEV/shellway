import { toast } from '@/components/ui/Toast'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSQLStore } from '@/stores/sqlStore'
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

export async function openInSqlTab(tabId: string, engine: DbEngine, database: string): Promise<void> {
  showSqlTab(tabId)
  const connection = useSQLStore.getState().connections[tabId]
  const sameEngine = connection?.connectionConfig?.type === (engine === 'mysql' ? 'mysql' : 'postgres')
  const sessionId = connection?.connectionStatus === 'connected' && sameEngine ? connection.sqlSessionId : null
  if (sessionId && engine === 'mysql' && (await switchDatabase(tabId, sessionId, database))) return
  toast.info(`Pick ${database} in the SQL tab`, sessionId ? undefined : 'Connect to the database server there first.')
}
