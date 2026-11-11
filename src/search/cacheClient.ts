import { create } from 'zustand'
import type { SearchCachePatch, SearchCacheSnapshot } from '@/types/search'
import { applyPatch, emptySnapshot, learnedKey, normalizeSnapshot } from './cachePatch'
import { frequencyFromCount, recencyFromTimestamp, type UsageLookup } from './ranking'
import type { SearchResult } from './types'

interface SearchCacheState {
  snapshot: SearchCacheSnapshot | null
}

const LEARNED_SATURATION = 3

export const useSearchCacheStore = create<SearchCacheState>(() => ({ snapshot: null }))

let loadPromise: Promise<void> | null = null

export function loadSearchCache(): Promise<void> {
  if (loadPromise) return loadPromise
  const api = window.novadeck?.search
  if (!api) return Promise.resolve()
  loadPromise = api
    .cacheGet()
    .then((raw) => {
      const loaded = normalizeSnapshot(raw)
      const current = useSearchCacheStore.getState().snapshot
      useSearchCacheStore.setState({ snapshot: current ? mergeLoaded(loaded, current) : loaded })
    })
    .catch(() => {
      if (!useSearchCacheStore.getState().snapshot) useSearchCacheStore.setState({ snapshot: emptySnapshot() })
    })
  return loadPromise
}

function mergeLoaded(loaded: SearchCacheSnapshot, current: SearchCacheSnapshot): SearchCacheSnapshot {
  return {
    ...loaded,
    tables: { ...loaded.tables, ...current.tables },
    servers: { ...loaded.servers, ...current.servers },
    paths: { ...loaded.paths, ...current.paths },
    usage: { ...loaded.usage, ...current.usage },
    learned: { ...loaded.learned, ...current.learned }
  }
}

export function applySearchCachePatch(patch: SearchCachePatch): void {
  const base = useSearchCacheStore.getState().snapshot ?? emptySnapshot()
  useSearchCacheStore.setState({ snapshot: applyPatch(base, patch, Date.now()) })
  window.novadeck?.search?.cacheApply(patch).catch(() => {})
}

export async function clearSearchCache(): Promise<void> {
  await window.novadeck.search.cacheClear()
  useSearchCacheStore.setState({ snapshot: emptySnapshot() })
}

export function getUsageLookup(): UsageLookup {
  const snapshot = useSearchCacheStore.getState().snapshot
  const now = Date.now()
  return {
    recency: (resultId) => recencyFromTimestamp(snapshot?.usage[resultId]?.lastUsedAt, now),
    frequency: (resultId) => frequencyFromCount(snapshot?.usage[resultId]?.count ?? 0),
    learned: (queryText, resultId) => {
      const picks = snapshot?.learned[learnedKey(queryText)]?.[resultId] ?? 0
      return Math.min(1, picks / LEARNED_SATURATION)
    }
  }
}

export function recordSelection(result: SearchResult, queryText: string): void {
  applySearchCachePatch({ kind: 'usage', resultId: result.id, queryText })
}
