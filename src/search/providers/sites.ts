import { sendIntent } from '../intentStore'
import { buildCollection, memoIndex, searchCollection } from '../miniIndex'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { allServerSnapshots, openServerRoute, serverMemoDeps } from './serverEntities'
import { copyText, isScopeConnected, localSearch, MAX_RESULTS, scopeName } from './shared'

interface SiteEntry {
  id: string
  scopeId: string
  name: string
  root: string
}

function buildEntries(): SiteEntry[] {
  return allServerSnapshots().flatMap(({ scopeId, sites }) =>
    sites.map((site) => ({ id: `site:${scopeId}:${site.name}`, scopeId, name: site.name, root: site.root ?? '' }))
  )
}

function contextHint(entry: SiteEntry, query: SearchQuery): number {
  if (entry.scopeId !== query.context.activeSessionId) return 0
  return entry.name === query.context.activeSite ? 1 : 0.5
}

function toResult(entry: SiteEntry, query: SearchQuery): SearchResult {
  const connected = isScopeConnected(entry.scopeId)
  const place = entry.root ? `${entry.root} · ${scopeName(entry.scopeId)}` : scopeName(entry.scopeId)
  return {
    id: entry.id,
    providerId: 'sites',
    title: entry.name,
    subtitle: `site · ${place}`,
    icon: 'site',
    hint: connected ? undefined : 'disconnected',
    scoreHints: { context: contextHint(entry, query), disconnected: !connected },
    payload: { scopeId: entry.scopeId, name: entry.name, root: entry.root }
  }
}

function compute(query: SearchQuery): SearchResult[] {
  if (!query.text) return []
  const collection = memoIndex('sites', serverMemoDeps(), () => buildCollection(buildEntries(), ['name', 'root']))
  return searchCollection(collection, query.text, MAX_RESULTS).map((entry) => toResult(entry, query))
}

export function createSitesProvider(): SearchProvider {
  return {
    id: 'sites',
    kind: 'local',
    scopes: ['sites'],
    search: localSearch(compute),
    actions(result): SearchAction[] {
      const { scopeId, name, root } = result.payload as { scopeId: string; name: string; root: string }
      const actions: SearchAction[] = [
        { id: 'open', label: 'Open', role: 'primary', run: () => openServerRoute(scopeId, { section: 'sites', params: { site: name } }) }
      ]
      if (root) {
        actions.push({ id: 'reveal', label: 'Reveal folder in SFTP', role: 'secondary', run: () => sendIntent(scopeId, { kind: 'sftp-reveal', path: root }) })
      }
      actions.push({ id: 'copy-name', label: 'Copy name', role: 'copy', run: () => copyText(name) })
      return actions
    }
  }
}
