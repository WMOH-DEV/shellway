export interface CachedTable {
  name: string
  type: 'table' | 'view'
  columns: string[]
}

export interface CachedSite {
  name: string
  root?: string
}

export interface CachedService {
  id: string
  name: string
  kind: 'service' | 'container'
}

export interface ServerEntities {
  sites: CachedSite[]
  services: CachedService[]
  updatedAt: number
}

export interface UsageEntry {
  count: number
  lastUsedAt: number
}

export interface SearchCacheSnapshot {
  version: number
  tables: Record<string, Record<string, CachedTable[]>>
  servers: Record<string, ServerEntities>
  paths: Record<string, string[]>
  usage: Record<string, UsageEntry>
  learned: Record<string, Record<string, number>>
}

export interface SearchCacheStats {
  entries: number
  bytes: number
}

export type SearchCachePatch =
  | { kind: 'tables'; scopeId: string; database: string; tables: CachedTable[] }
  | { kind: 'server'; scopeId: string; sites: CachedSite[]; services: CachedService[] }
  | { kind: 'paths'; scopeId: string; paths: string[] }
  | { kind: 'usage'; resultId: string; queryText: string }
  | { kind: 'forget'; scopeId: string }

export interface FileNameSearchRequest {
  connectionId: string
  root: string
  text: string
  excludes: string[]
}

export interface TextSearchRequest {
  connectionId: string
  root: string
  text: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  includes: string[]
  excludes: string[]
}

export interface TextMatch {
  path: string
  line: number
  text: string
  ranges: Array<[number, number]>
}

export interface RemoteSearchStarted {
  searchId: string
  command: string
}

export type RemoteSearchEvent =
  | { searchId: string; kind: 'files'; paths: string[] }
  | { searchId: string; kind: 'text'; matches: TextMatch[] }
  | { searchId: string; kind: 'done'; truncated: boolean; timedOut: boolean; error?: string }

export interface PreviewLine {
  line: number
  text: string
}
