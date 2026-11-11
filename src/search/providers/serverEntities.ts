import { useConnectionStore } from '@/stores/connectionStore'
import { useServerFactsStore } from '@/stores/serverFactsStore'
import { useServerNavStore } from '@/stores/serverNavStore'
import { useUIStore } from '@/stores/uiStore'
import type { CachedService, CachedSite } from '@/types/search'
import type { ServerFacts, ServerRoute } from '@/types/server/core'
import { buildServiceList } from '@/utils/server/services/list'
import { inventoryFrom } from '@/utils/server/sites/inventory'
import { useSearchCacheStore } from '../cacheClient'
import { isScopeConnected, tabForScope } from './shared'

export interface ServerSnapshot {
  scopeId: string
  sites: CachedSite[]
  services: CachedService[]
}

export function snapshotFromFacts(scopeId: string, facts: ServerFacts): ServerSnapshot {
  const inventory = inventoryFrom(facts)
  return {
    scopeId,
    sites: inventory ? inventory.sites.map((s) => ({ name: s.name, root: s.path })) : [],
    services: buildServiceList(facts).map((s) => ({ id: s.id, name: s.name, kind: s.kind === 'container' ? 'container' : 'service' }))
  }
}

export function liveServerSnapshots(): ServerSnapshot[] {
  const { byConnection } = useServerFactsStore.getState()
  return useConnectionStore
    .getState()
    .tabs.filter((tab) => byConnection[tab.id])
    .map((tab) => snapshotFromFacts(tab.sessionId, byConnection[tab.id]))
}

export function allServerSnapshots(): ServerSnapshot[] {
  const cached = useSearchCacheStore.getState().snapshot?.servers ?? {}
  const merged = new Map<string, ServerSnapshot>(
    Object.entries(cached).map(([scopeId, server]) => [scopeId, { scopeId, sites: server.sites, services: server.services }])
  )
  for (const live of liveServerSnapshots()) {
    const previous = merged.get(live.scopeId)
    merged.set(live.scopeId, {
      scopeId: live.scopeId,
      sites: live.sites.length > 0 ? live.sites : (previous?.sites ?? []),
      services: live.services.length > 0 ? live.services : (previous?.services ?? [])
    })
  }
  return [...merged.values()]
}

export function serverMemoDeps(): unknown[] {
  const { byConnection } = useServerFactsStore.getState()
  const liveDeps = useConnectionStore.getState().tabs.flatMap((tab) => [tab.sessionId, byConnection[tab.id]])
  return [useSearchCacheStore.getState().snapshot?.servers, ...liveDeps]
}

export function openServerRoute(scopeId: string, route: ServerRoute): void {
  const tab = tabForScope(scopeId)
  if (tab && isScopeConnected(scopeId)) useServerNavStore.getState().openServer(tab.id, route)
  else useUIStore.getState().requestConnectSession(scopeId)
}
