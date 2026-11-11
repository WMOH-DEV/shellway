import { useMemo } from 'react'
import { getSQLConnectionState, useSQLConnection } from '@/stores/sqlStore'
import { tabsInDatabase, type TabsState } from './tabModel'

export function getDatabaseTabs(connectionId: string): TabsState {
  const s = getSQLConnectionState(connectionId)
  return tabsInDatabase({ tabs: s.tabs, activeTabId: s.activeTabId, mru: s.mru, closed: s.closedTabs }, s.currentDatabase)
}

export function useDatabaseTabs(connectionId: string): TabsState {
  const { tabs, activeTabId, mru, closedTabs, currentDatabase } = useSQLConnection(connectionId)
  return useMemo(
    () => tabsInDatabase({ tabs, activeTabId, mru, closed: closedTabs }, currentDatabase),
    [tabs, activeTabId, mru, closedTabs, currentDatabase]
  )
}
