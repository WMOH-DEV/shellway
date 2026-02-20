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

interface ConnectionState {
  /** All open connection tabs */
  tabs: ConnectionTab[]
  /** ID of the active (selected) tab */
  activeTabId: string | null
  /** Reconnection state per tab */
  reconnectionState: Map<string, ReconnectionTabState>

  /** Add a new connection tab */
  addTab: (tab: ConnectionTab) => void
  /** Remove a connection tab by ID */
  removeTab: (id: string) => void
  /** Set the active tab */
  setActiveTab: (id: string) => void
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

  addTab: (tab) =>
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id
    })),

  removeTab: (id) =>
    set((state) => {
      const idx = state.tabs.findIndex((t) => t.id === id)
      const newTabs = state.tabs.filter((t) => t.id !== id)
      let newActiveId = state.activeTabId

      // If we closed the active tab, pick adjacent
      if (state.activeTabId === id) {
        if (newTabs.length === 0) {
          newActiveId = null
        } else if (idx >= newTabs.length) {
          newActiveId = newTabs[newTabs.length - 1].id
        } else {
          newActiveId = newTabs[idx].id
        }
      }

      // Clean up reconnection state
      const newReconnection = new Map(state.reconnectionState)
      newReconnection.delete(id)

      return { tabs: newTabs, activeTabId: newActiveId, reconnectionState: newReconnection }
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, updates) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t))
    })),

  closeAllTabs: () => set({ tabs: [], activeTabId: null, reconnectionState: new Map() }),

  closeOtherTabs: (id) =>
    set((state) => {
      // Clean up reconnection states for closed tabs
      const newReconnection = new Map<string, ReconnectionTabState>()
      const existing = state.reconnectionState.get(id)
      if (existing) {
        newReconnection.set(id, existing)
      }

      return {
        tabs: state.tabs.filter((t) => t.id === id),
        activeTabId: id,
        reconnectionState: newReconnection
      }
    }),

  reorderTabs: (oldIndex, newIndex) =>
    set((state) => {
      const newTabs = [...state.tabs]
      const [moved] = newTabs.splice(oldIndex, 1)
      newTabs.splice(newIndex, 0, moved)
      return { tabs: newTabs }
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
    })
}))
