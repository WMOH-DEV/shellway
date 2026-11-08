import { create } from 'zustand'
import type { ServerRoute } from '@/types/server/core'
import type { ConnectionTab } from '@/types/session'
import { useConnectionStore } from './connectionStore'

export const DEFAULT_SERVER_ROUTE: ServerRoute = { section: 'overview' }

interface ServerNavState {
  routes: Record<string, ServerRoute>
  navigate(tabId: string, route: ServerRoute): void
  openServer(tabId: string, route: ServerRoute): void
}

function withServerRunning(running: ConnectionTab['runningSubTabs']): ConnectionTab['runningSubTabs'] {
  if (!running || running.includes('server')) return running
  return [...running, 'server']
}

function showServerSubTab(tabId: string, route: ServerRoute): void {
  const tab = useConnectionStore.getState().tabs.find((t) => t.id === tabId)
  if (!tab) return
  useConnectionStore.getState().updateTab(tabId, { activeSubTab: 'server', runningSubTabs: withServerRunning(tab.runningSubTabs) })
  if (tab.detachedSubTabs?.includes('server')) void window.novadeck.window.focusFeature({ tabId, subTab: 'server' }, route)
}

export const useServerNavStore = create<ServerNavState>((set, get) => ({
  routes: {},
  navigate: (tabId, route) => set((state) => ({ routes: { ...state.routes, [tabId]: route } })),
  openServer: (tabId, route) => {
    get().navigate(tabId, route)
    showServerSubTab(tabId, route)
  }
}))

export const serverRouteOf = (tabId: string): ServerRoute => useServerNavStore.getState().routes[tabId] ?? DEFAULT_SERVER_ROUTE

export const useServerRoute = (tabId: string): ServerRoute =>
  useServerNavStore((state) => state.routes[tabId] ?? DEFAULT_SERVER_ROUTE)

function isServerRoute(value: unknown): value is ServerRoute {
  return typeof value === 'object' && value !== null && typeof (value as ServerRoute).section === 'string'
}

export function followFeatureRoutes(): () => void {
  return window.novadeck.window.onFeatureRoute((ref, route) => {
    if (ref.subTab === 'server' && isServerRoute(route)) useServerNavStore.getState().navigate(ref.tabId, route)
  })
}
