import type { ServerRoute } from '@/types/server/core'
import type { ConnectionTab } from '@/types/session'

type SubTab = ConnectionTab['activeSubTab']

export type ClassicSubTab = 'monitor' | 'services' | 'deploy' | 'ssl' | 'info'

export const LEGACY_ROUTES: Readonly<Record<ClassicSubTab, ServerRoute>> = {
  deploy: { section: 'sites' },
  ssl: { section: 'sites', sub: 'https' },
  services: { section: 'services' },
  monitor: { section: 'overview', sub: 'metrics' },
  info: { section: 'overview' }
}

export const CLASSIC_SUB_TABS = Object.keys(LEGACY_ROUTES) as ClassicSubTab[]

export const isClassicSubTab = (id: string): id is ClassicSubTab => Object.hasOwn(LEGACY_ROUTES, id)

export interface NormalizedSubTab {
  subTab: SubTab
  route?: ServerRoute
}

export function normalizeSubTab(id: SubTab, classicEnabled: boolean): NormalizedSubTab {
  if (classicEnabled || !isClassicSubTab(id)) return { subTab: id }
  return { subTab: 'server', route: { ...LEGACY_ROUTES[id] } }
}

export function normalizeSubTabList(ids: readonly SubTab[], classicEnabled: boolean): SubTab[] {
  return [...new Set(ids.map((id) => normalizeSubTab(id, classicEnabled).subTab))]
}

export function normalizeTab(tab: ConnectionTab, classicEnabled: boolean): { tab: ConnectionTab; route?: ServerRoute } {
  const { subTab, route } = normalizeSubTab(tab.activeSubTab, classicEnabled)
  const runningSubTabs = tab.runningSubTabs && normalizeSubTabList(tab.runningSubTabs, classicEnabled)
  return { tab: { ...tab, activeSubTab: subTab, runningSubTabs }, route }
}
