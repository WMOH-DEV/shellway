import { useConnectionStore } from '@/stores/connectionStore'
import { serverRouteOf } from '@/stores/serverNavStore'
import { useSQLStore } from '@/stores/sqlStore'
import type { SearchContext } from './types'

function activeSiteOf(tabId: string | null): string | null {
  if (!tabId) return null
  const route = serverRouteOf(tabId)
  return route.section === 'sites' ? (route.params?.site ?? null) : null
}

export function getSearchContext(): SearchContext {
  const { tabs, activeTabId } = useConnectionStore.getState()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const database = activeTabId ? useSQLStore.getState().connections[activeTabId]?.currentDatabase : ''
  return {
    activeTabId: activeTab?.id ?? null,
    activeSessionId: activeTab?.sessionId ?? null,
    activeDatabase: database || null,
    activeSite: activeSiteOf(activeTab?.id ?? null),
    connectedTabIds: tabs.filter((t) => t.status === 'connected').map((t) => t.id)
  }
}
