import { vi } from 'vitest'
import { useSearchCacheStore } from '../cacheClient'
import { clearMemoIndexes } from '../miniIndex'
import { emptySnapshot } from '../cachePatch'
import { useSearchIntentStore } from '../intentStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useServerFactsStore } from '@/stores/serverFactsStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSnippetStore } from '@/stores/snippetStore'
import { useSQLStore } from '@/stores/sqlStore'
import { useUIStore } from '@/stores/uiStore'
import type { ConnectionTab, Session } from '@/types/session'
import type { SearchContext, SearchProvider, SearchQuery, SearchResult } from '../types'

export function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'Shop server',
    host: 'shop.example.com',
    port: 22,
    username: 'deploy',
    auth: { initialMethod: 'password' },
    proxy: { type: 'none', host: '', port: 0, requiresAuth: false },
    overrides: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

export function makeTab(overrides: Partial<ConnectionTab> = {}): ConnectionTab {
  return { id: 't1', sessionId: 's1', sessionName: 'Shop server', status: 'connected', activeSubTab: 'terminal', ...overrides }
}

export const EMPTY_CONTEXT: SearchContext = {
  activeTabId: null,
  activeSessionId: null,
  activeDatabase: null,
  activeSite: null,
  connectedTabIds: []
}

export function makeQuery(text: string, overrides: Partial<SearchQuery> = {}): SearchQuery {
  return { raw: text, text, scope: 'all', prefix: null, serverFilter: 'all', context: EMPTY_CONTEXT, ...overrides }
}

export function resetSearchState(): void {
  clearMemoIndexes()
  useSearchCacheStore.setState({ snapshot: emptySnapshot() })
  useSearchIntentStore.setState({ pending: {} })
  useConnectionStore.setState({ tabs: [], activeTabId: null })
  useServerFactsStore.setState({ byConnection: {} })
  useSessionStore.setState({ sessions: [] })
  useSnippetStore.setState({ snippets: [] })
  useSQLStore.setState({ connections: {} })
  useUIStore.setState({ connectSessionId: null, selectedSessionId: null })
}

export function stubBrowser(novadeck: Record<string, unknown> = {}): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { platform: 'Linux', clipboard: { writeText } })
  vi.stubGlobal('window', { novadeck })
  return { writeText }
}

export async function collect(provider: SearchProvider, query: SearchQuery, signal: AbortSignal = new AbortController().signal): Promise<SearchResult[]> {
  const all: SearchResult[] = []
  for await (const batch of provider.search(query, signal)) all.push(...batch)
  return all
}
