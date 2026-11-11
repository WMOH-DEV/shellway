import { buildCollection, memoIndex, searchCollection } from '../miniIndex'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { allServerSnapshots, openServerRoute, serverMemoDeps } from './serverEntities'
import { copyText, isScopeConnected, localSearch, MAX_RESULTS, scopeName } from './shared'

interface ServiceEntry {
  id: string
  scopeId: string
  serviceId: string
  name: string
  kind: 'service' | 'container'
}

function buildEntries(): ServiceEntry[] {
  return allServerSnapshots().flatMap(({ scopeId, services }) =>
    services.map((service) => ({
      id: `service:${scopeId}:${service.id}`,
      scopeId,
      serviceId: service.id,
      name: service.name,
      kind: service.kind
    }))
  )
}

function toResult(entry: ServiceEntry, query: SearchQuery): SearchResult {
  const connected = isScopeConnected(entry.scopeId)
  return {
    id: entry.id,
    providerId: 'services',
    title: entry.name,
    subtitle: `${entry.kind} · ${scopeName(entry.scopeId)}`,
    icon: 'service',
    hint: connected ? undefined : 'disconnected',
    scoreHints: { context: entry.scopeId === query.context.activeSessionId ? 0.5 : 0, disconnected: !connected },
    payload: { scopeId: entry.scopeId, serviceId: entry.serviceId, name: entry.name }
  }
}

function compute(query: SearchQuery): SearchResult[] {
  if (!query.text) return []
  const collection = memoIndex('services', serverMemoDeps(), () => buildCollection(buildEntries(), ['name']))
  return searchCollection(collection, query.text, MAX_RESULTS).map((entry) => toResult(entry, query))
}

export function createServicesProvider(): SearchProvider {
  return {
    id: 'services',
    kind: 'local',
    scopes: ['sites'],
    search: localSearch(compute),
    actions(result): SearchAction[] {
      const { scopeId, serviceId, name } = result.payload as { scopeId: string; serviceId: string; name: string }
      return [
        { id: 'open', label: 'Open', role: 'primary', run: () => openServerRoute(scopeId, { section: 'services', params: { id: serviceId } }) },
        { id: 'copy-name', label: 'Copy name', role: 'copy', run: () => copyText(name) }
      ]
    }
  }
}
