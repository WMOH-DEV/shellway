import type { SearchContext } from './types'

export function getSearchContext(): SearchContext {
  return { activeTabId: null, activeSessionId: null, activeDatabase: null, activeSite: null, connectedTabIds: [] }
}
