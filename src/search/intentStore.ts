import { create } from 'zustand'
import { useConnectionStore } from '@/stores/connectionStore'
import type { ConnectionTab } from '@/types/session'

export type SearchIntent =
  | { kind: 'open-table'; database: string; table: string; newTab: boolean }
  | { kind: 'open-sql'; sql: string; title: string; database?: string }
  | { kind: 'sftp-reveal'; path: string }
  | { kind: 'sftp-open'; path: string; line?: number }

export type IntentKind = SearchIntent['kind']

interface IntentState {
  pending: Record<string, SearchIntent[]>
  push(tabId: string, intent: SearchIntent): void
  take(tabId: string, kinds: IntentKind[]): SearchIntent[]
}

export const useSearchIntentStore = create<IntentState>((set, get) => ({
  pending: {},
  push: (tabId, intent) =>
    set((s) => ({ pending: { ...s.pending, [tabId]: [...(s.pending[tabId] ?? []), intent] } })),
  take: (tabId, kinds) => {
    const all = get().pending[tabId] ?? []
    const taken = all.filter((i) => kinds.includes(i.kind))
    if (taken.length === 0) return taken
    const rest = all.filter((i) => !kinds.includes(i.kind))
    set((s) => ({ pending: { ...s.pending, [tabId]: rest } }))
    return taken
  }
}))

type SubTab = ConnectionTab['activeSubTab']

export function showSubTab(tabId: string, subTab: SubTab): void {
  const store = useConnectionStore.getState()
  const tab = store.tabs.find((t) => t.id === tabId)
  if (!tab) return
  const running = tab.runningSubTabs && !tab.runningSubTabs.includes(subTab) ? [...tab.runningSubTabs, subTab] : tab.runningSubTabs
  store.setActiveTab(tabId)
  store.updateTab(tabId, { activeSubTab: subTab, runningSubTabs: running })
  if (tab.detachedSubTabs?.includes(subTab)) void window.novadeck.window.focusFeature({ tabId, subTab })
}

export function sendIntent(tabId: string, subTab: SubTab, intent: SearchIntent): void {
  useSearchIntentStore.getState().push(tabId, intent)
  showSubTab(tabId, subTab)
}
