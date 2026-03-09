import { create } from 'zustand'
import type { ConnectionTab } from '@/types/session'

/** Reconnection state for a single connection tab */
export interface ReconnectionTabState {
  state: 'idle' | 'waiting' | 'attempting' | 'paused'
  attempt: number
  maxAttempts: number
  nextRetryAt: number | null
  recentEvents: string[]
}

/** A pane that holds one or more connection tabs */
export interface Pane {
  id: string
  tabIds: string[]
  activeTabId: string | null
}

/** Derive the global activeTabId from the active pane */
function deriveActiveTabId(panes: Pane[], activePaneId: string): string | null {
  const pane = panes.find(p => p.id === activePaneId)
  return pane?.activeTabId ?? null
}

interface ConnectionState {
  /** All open connection tabs */
  tabs: ConnectionTab[]
  /** ID of the active (selected) tab */
  activeTabId: string | null
  /** Reconnection state per tab */
  reconnectionState: Map<string, ReconnectionTabState>
  /** Split panes */
  panes: Pane[]
  /** Currently focused pane */
  activePaneId: string
  /** Direction of the split */
  splitDirection: 'horizontal' | 'vertical'

  /** Add a new connection tab */
  addTab: (tab: ConnectionTab) => void
  /** Remove a connection tab by ID */
  removeTab: (id: string) => void
  /** Set the active tab (null to deselect all) */
  setActiveTab: (id: string | null) => void
  /** Update a tab's properties */
  updateTab: (id: string, updates: Partial<ConnectionTab>) => void
  /** Close all tabs */
  closeAllTabs: () => void
  /** Close all tabs except the specified one */
  closeOtherTabs: (id: string) => void
  /** Reorder tabs (move tab from oldIndex to newIndex) */
  reorderTabs: (oldIndex: number, newIndex: number) => void
  /** Set the reconnection state for a tab */
  setReconnectionState: (tabId: string, state: Partial<ReconnectionTabState>) => void
  /** Add a reconnection event to a tab's recent events */
  addReconnectionEvent: (tabId: string, event: string) => void
  /** Split a tab into a new pane */
  splitPane: (tabId: string, direction: 'horizontal' | 'vertical') => void
  /** Close a pane, merging its tabs into the remaining pane */
  closePane: (paneId: string) => void
  /** Set the active pane */
  setActivePane: (paneId: string) => void
  /** Move a tab from its current pane to a target pane */
  moveTabToPane: (tabId: string, targetPaneId: string) => void
  /** Set the active tab within a specific pane */
  setPaneActiveTab: (paneId: string, tabId: string) => void
}

const DEFAULT_RECONNECTION_STATE: ReconnectionTabState = {
  state: 'idle',
  attempt: 0,
  maxAttempts: 0,
  nextRetryAt: null,
  recentEvents: []
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  tabs: [],
  activeTabId: null,
  reconnectionState: new Map(),
  panes: [{ id: 'main', tabIds: [], activeTabId: null }],
  activePaneId: 'main',
  splitDirection: 'horizontal',

  addTab: (tab) =>
    set((state) => {
      const paneIdx = state.panes.findIndex(p => p.id === state.activePaneId)
      const newPanes = state.panes.map((p, i) =>
        i === paneIdx
          ? { ...p, tabIds: [...p.tabIds, tab.id], activeTabId: tab.id }
          : p
      )
      return {
        tabs: [...state.tabs, tab],
        panes: newPanes,
        activeTabId: tab.id
      }
    }),

  removeTab: (id) =>
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== id)

      let newPanes = state.panes.map(pane => {
        if (!pane.tabIds.includes(id)) return pane
        const newTabIds = pane.tabIds.filter(tid => tid !== id)
        let newActiveTabId = pane.activeTabId
        if (pane.activeTabId === id) {
          const idx = pane.tabIds.indexOf(id)
          if (newTabIds.length === 0) {
            newActiveTabId = null
          } else if (idx >= newTabIds.length) {
            newActiveTabId = newTabIds[newTabIds.length - 1]
          } else {
            newActiveTabId = newTabIds[idx]
          }
        }
        return { ...pane, tabIds: newTabIds, activeTabId: newActiveTabId }
      })

      // Auto-close empty pane when split
      if (newPanes.length === 2) {
        const emptyPane = newPanes.find(p => p.tabIds.length === 0)
        if (emptyPane) {
          const remainingPane = newPanes.find(p => p.id !== emptyPane.id)!
          newPanes = [remainingPane]
        }
      }

      const newActivePaneId = newPanes.find(p => p.id === state.activePaneId)?.id ?? newPanes[0].id
      const newReconnection = new Map(state.reconnectionState)
      newReconnection.delete(id)

      return {
        tabs: newTabs,
        panes: newPanes,
        activePaneId: newActivePaneId,
        activeTabId: deriveActiveTabId(newPanes, newActivePaneId),
        reconnectionState: newReconnection
      }
    }),

  setActiveTab: (id) =>
    set((state) => {
      if (id === null) {
        return { activeTabId: null }
      }
      const pane = state.panes.find(p => p.tabIds.includes(id))
      if (!pane) return { activeTabId: id }

      const newPanes = state.panes.map(p =>
        p.id === pane.id ? { ...p, activeTabId: id } : p
      )
      return {
        panes: newPanes,
        activePaneId: pane.id,
        activeTabId: id
      }
    }),

  updateTab: (id, updates) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t))
    })),

  closeAllTabs: () => set({
    tabs: [],
    panes: [{ id: 'main', tabIds: [], activeTabId: null }],
    activePaneId: 'main',
    activeTabId: null,
    reconnectionState: new Map()
  }),

  closeOtherTabs: (id) =>
    set((state) => {
      const newReconnection = new Map<string, ReconnectionTabState>()
      const existing = state.reconnectionState.get(id)
      if (existing) newReconnection.set(id, existing)

      return {
        tabs: state.tabs.filter((t) => t.id === id),
        panes: [{ id: 'main', tabIds: [id], activeTabId: id }],
        activePaneId: 'main',
        activeTabId: id,
        reconnectionState: newReconnection
      }
    }),

  reorderTabs: (oldIndex, newIndex) =>
    set((state) => {
      const pane = state.panes.find(p => p.id === state.activePaneId)
      if (!pane) return {}

      const newTabIds = [...pane.tabIds]
      const [moved] = newTabIds.splice(oldIndex, 1)
      newTabIds.splice(newIndex, 0, moved)

      return {
        panes: state.panes.map(p =>
          p.id === pane.id ? { ...p, tabIds: newTabIds } : p
        )
      }
    }),

  setReconnectionState: (tabId, partial) =>
    set((state) => {
      const newMap = new Map(state.reconnectionState)
      const current = newMap.get(tabId) || { ...DEFAULT_RECONNECTION_STATE }
      newMap.set(tabId, { ...current, ...partial })
      return { reconnectionState: newMap }
    }),

  addReconnectionEvent: (tabId, event) =>
    set((state) => {
      const newMap = new Map(state.reconnectionState)
      const current = newMap.get(tabId) || { ...DEFAULT_RECONNECTION_STATE }
      // Keep only the last 8 events
      const recentEvents = [...current.recentEvents, event].slice(-8)
      newMap.set(tabId, { ...current, recentEvents })
      return { reconnectionState: newMap }
    }),

  splitPane: (tabId, direction) =>
    set((state) => {
      // Already split? Move tab to the other pane
      if (state.panes.length >= 2) {
        const currentPane = state.panes.find(p => p.tabIds.includes(tabId))
        const otherPane = state.panes.find(p => p.id !== currentPane?.id)
        if (!currentPane || !otherPane) return {}
        if (currentPane.tabIds.length <= 1) return {}

        const newCurrentTabIds = currentPane.tabIds.filter(id => id !== tabId)
        const newCurrentActive = currentPane.activeTabId === tabId
          ? newCurrentTabIds[0] ?? null
          : currentPane.activeTabId

        return {
          panes: state.panes.map(p => {
            if (p.id === currentPane.id) return { ...p, tabIds: newCurrentTabIds, activeTabId: newCurrentActive }
            if (p.id === otherPane.id) return { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId }
            return p
          }),
          splitDirection: direction,
          activePaneId: otherPane.id,
          activeTabId: tabId
        }
      }

      const currentPane = state.panes[0]
      if (currentPane.tabIds.length <= 1) return {}

      const newPaneId = crypto.randomUUID()
      const newCurrentTabIds = currentPane.tabIds.filter(id => id !== tabId)
      const newCurrentActive = currentPane.activeTabId === tabId
        ? newCurrentTabIds[0] ?? null
        : currentPane.activeTabId

      return {
        panes: [
          { ...currentPane, tabIds: newCurrentTabIds, activeTabId: newCurrentActive },
          { id: newPaneId, tabIds: [tabId], activeTabId: tabId }
        ],
        splitDirection: direction,
        activePaneId: newPaneId,
        activeTabId: tabId
      }
    }),

  closePane: (paneId) =>
    set((state) => {
      if (state.panes.length <= 1) return {}

      const closingPane = state.panes.find(p => p.id === paneId)
      const remainingPane = state.panes.find(p => p.id !== paneId)
      if (!closingPane || !remainingPane) return {}

      const mergedTabIds = [...remainingPane.tabIds, ...closingPane.tabIds]
      const mergedPane = {
        ...remainingPane,
        tabIds: mergedTabIds,
        activeTabId: remainingPane.activeTabId
      }

      return {
        panes: [mergedPane],
        activePaneId: mergedPane.id,
        activeTabId: mergedPane.activeTabId
      }
    }),

  setActivePane: (paneId) =>
    set((state) => {
      const pane = state.panes.find(p => p.id === paneId)
      return {
        activePaneId: paneId,
        activeTabId: pane?.activeTabId ?? null
      }
    }),

  moveTabToPane: (tabId, targetPaneId) =>
    set((state) => {
      const sourcePane = state.panes.find(p => p.tabIds.includes(tabId))
      const targetPane = state.panes.find(p => p.id === targetPaneId)
      if (!sourcePane || !targetPane || sourcePane.id === targetPane.id) return {}
      if (sourcePane.tabIds.length <= 1) return {}

      const newSourceTabIds = sourcePane.tabIds.filter(id => id !== tabId)
      const newSourceActive = sourcePane.activeTabId === tabId
        ? newSourceTabIds[0] ?? null
        : sourcePane.activeTabId

      return {
        panes: state.panes.map(p => {
          if (p.id === sourcePane.id) return { ...p, tabIds: newSourceTabIds, activeTabId: newSourceActive }
          if (p.id === targetPane.id) return { ...p, tabIds: [...p.tabIds, tabId], activeTabId: tabId }
          return p
        }),
        activePaneId: targetPaneId,
        activeTabId: tabId
      }
    }),

  setPaneActiveTab: (paneId, tabId) =>
    set((state) => {
      const newPanes = state.panes.map(p =>
        p.id === paneId ? { ...p, activeTabId: tabId } : p
      )
      const newActiveTabId = paneId === state.activePaneId ? tabId : state.activeTabId
      return { panes: newPanes, activeTabId: newActiveTabId }
    })
}))
