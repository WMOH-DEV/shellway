export type ProviderId =
  | 'commands'
  | 'sessions'
  | 'tables'
  | 'queries'
  | 'history'
  | 'files'
  | 'sites'
  | 'services'
  | 'snippets'
  | 'settings'

export type ScopeId = 'all' | 'tables' | 'queries' | 'files' | 'commands' | 'sites' | 'history' | 'settings' | 'servers'

export type SearchPrefix = '>' | '@' | '#' | '/' | '?'

export type ServerFilter = 'current' | 'all'

export interface SearchContext {
  activeTabId: string | null
  activeSessionId: string | null
  activeDatabase: string | null
  activeSite: string | null
  connectedTabIds: string[]
}

export interface SearchQuery {
  raw: string
  text: string
  scope: ScopeId
  prefix: SearchPrefix | null
  serverFilter: ServerFilter
  context: SearchContext
}

export type ResultIcon =
  | 'table'
  | 'column'
  | 'query'
  | 'history'
  | 'file'
  | 'folder'
  | 'command'
  | 'server'
  | 'database'
  | 'site'
  | 'service'
  | 'snippet'
  | 'setting'

export interface ScoreHints {
  recency?: number
  frequency?: number
  context?: number
  disconnected?: boolean
  weight?: number
}

export interface SearchResult {
  id: string
  providerId: ProviderId
  title: string
  subtitle: string
  icon: ResultIcon
  hint?: string
  keywords?: string
  scoreHints: ScoreHints
  payload: unknown
}

export interface ScoredResult extends SearchResult {
  score: number
}

export type ActionRole = 'primary' | 'secondary' | 'copy' | 'extra'

export interface SearchAction {
  id: string
  label: string
  role: ActionRole
  run: () => void | Promise<void>
}

export interface SearchProvider {
  id: ProviderId
  kind: 'local' | 'remote'
  scopes: ScopeId[]
  search(query: SearchQuery, signal: AbortSignal): AsyncIterable<SearchResult[]>
  actions(result: SearchResult): SearchAction[]
}

export interface ResultGroup {
  providerId: ProviderId
  label: string
  results: ScoredResult[]
  overflow: number
}
