import { useSearchCacheStore } from '../cacheClient'
import { buildCollection, memoIndex, searchCollection } from '../miniIndex'
import type { SearchProvider, SearchQuery, SearchResult } from '../types'
import { fileActions, toFileResult } from './fileResult'
import { localSearch, MAX_RESULTS } from './shared'

const INDEXED_FIELDS = ['name', 'path']

interface FileEntry {
  id: string
  scopeId: string
  rawPath: string
  name: string
  path: string
}

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

function buildEntries(paths: Record<string, string[]>): FileEntry[] {
  return Object.entries(paths).flatMap(([scopeId, list]) =>
    list.map((rawPath) => ({ id: `${scopeId}\n${rawPath}`, scopeId, rawPath, name: baseName(rawPath), path: rawPath }))
  )
}

function compute(query: SearchQuery): SearchResult[] {
  if (!query.text) return []
  const paths = useSearchCacheStore.getState().snapshot?.paths
  if (!paths) return []
  const collection = memoIndex('files', [paths], () => buildCollection(buildEntries(paths), INDEXED_FIELDS))
  return searchCollection(collection, query.text, MAX_RESULTS).map((entry) => toFileResult(entry.rawPath, entry.scopeId, query))
}

export function createFilesProvider(): SearchProvider {
  return {
    id: 'files',
    kind: 'local',
    scopes: ['files'],
    search: localSearch(compute),
    actions: fileActions
  }
}
