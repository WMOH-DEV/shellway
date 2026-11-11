import { create } from 'zustand'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUIStore } from '@/stores/uiStore'
import type { ConnectionTab } from '@/types/session'

export type SqlIntentAction = 'export' | 'import' | 'backup' | 'restore' | 'refresh' | 'create-table' | 'new-query'

export type SearchIntent =
  | { kind: 'open-table'; database: string; table: string; newTab: boolean }
  | { kind: 'open-sql'; sql: string; title: string; database?: string }
  | { kind: 'sql-action'; action: SqlIntentAction }
  | { kind: 'sftp-reveal'; path: string }
  | { kind: 'sftp-open'; path: string; line?: number }
  | { kind: 'terminal-insert'; text: string }

export type IntentKind = SearchIntent['kind']

type SubTab = ConnectionTab['activeSubTab']

export const SQL_INTENTS: IntentKind[] = ['open-table', 'open-sql', 'sql-action']
export const SFTP_INTENTS: IntentKind[] = ['sftp-reveal', 'sftp-open']
export const TERMINAL_INTENTS: IntentKind[] = ['terminal-insert']

export function subTabForIntent(kind: IntentKind): SubTab {
  if (SQL_INTENTS.includes(kind)) return 'sql'
  if (SFTP_INTENTS.includes(kind)) return 'sftp'
  return 'terminal'
}

interface IntentState {
  pending: Record<string, SearchIntent[]>
  push(sessionId: string, intent: SearchIntent): void
  take(sessionId: string, kinds: IntentKind[]): SearchIntent[]
}

export const useSearchIntentStore = create<IntentState>((set, get) => ({
  pending: {},
  push: (sessionId, intent) =>
    set((s) => ({ pending: { ...s.pending, [sessionId]: [...(s.pending[sessionId] ?? []), intent] } })),
  take: (sessionId, kinds) => {
    const all = get().pending[sessionId] ?? []
    const taken = all.filter((i) => kinds.includes(i.kind))
    if (taken.length === 0) return taken
    const rest = all.filter((i) => !kinds.includes(i.kind))
    set((s) => ({ pending: { ...s.pending, [sessionId]: rest } }))
    return taken
  }
}))

export function tabForSession(sessionId: string): ConnectionTab | undefined {
  return useConnectionStore.getState().tabs.find((t) => t.sessionId === sessionId)
}

export function showSubTab(tabId: string, subTab: SubTab): void {
  const store = useConnectionStore.getState()
  const tab = store.tabs.find((t) => t.id === tabId)
  if (!tab) return
  const running = tab.runningSubTabs && !tab.runningSubTabs.includes(subTab) ? [...tab.runningSubTabs, subTab] : tab.runningSubTabs
  store.setActiveTab(tabId)
  store.updateTab(tabId, { activeSubTab: subTab, runningSubTabs: running })
  if (tab.detachedSubTabs?.includes(subTab)) void window.novadeck.window.focusFeature({ tabId, subTab })
}

export function sendIntent(sessionId: string, intent: SearchIntent): void {
  useSearchIntentStore.getState().push(sessionId, intent)
  const tab = tabForSession(sessionId)
  if (!tab) {
    useUIStore.getState().requestConnectSession(sessionId)
    return
  }
  if (tab.status === 'connected') showSubTab(tab.id, subTabForIntent(intent.kind))
  else useConnectionStore.getState().setActiveTab(tab.id)
}
