import { create } from 'zustand'
import type { SearchCachePatch, SearchCacheSnapshot } from '@/types/search'
import { NO_USAGE, type UsageLookup } from './ranking'
import type { SearchResult } from './types'

interface SearchCacheState {
  snapshot: SearchCacheSnapshot | null
}

export const useSearchCacheStore = create<SearchCacheState>(() => ({ snapshot: null }))

export function loadSearchCache(): Promise<void> {
  return Promise.resolve()
}

export function applySearchCachePatch(_patch: SearchCachePatch): void {}

export function clearSearchCache(): Promise<void> {
  return Promise.resolve()
}

export function getUsageLookup(): UsageLookup {
  return NO_USAGE
}

export function recordSelection(_result: SearchResult, _queryText: string): void {}
