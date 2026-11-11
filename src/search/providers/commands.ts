import { useKeybindingStore } from '@/stores/keybindingStore'
import { useSearchCacheStore } from '../cacheClient'
import { buildCollection, memoIndex, searchCollection } from '../miniIndex'
import { buildCommandEntries, type CommandEntry } from '../registries/commands'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { localSearch, MAX_RESULTS } from './shared'

const EMPTY_QUERY_LIMIT = 5

function resultId(entry: CommandEntry): string {
  return `command:${entry.id}`
}

function toResult(entry: CommandEntry): SearchResult {
  return {
    id: resultId(entry),
    providerId: 'commands',
    title: entry.title,
    subtitle: entry.subtitle,
    icon: 'command',
    hint: '>',
    keywords: entry.keywords,
    scoreHints: { context: entry.contextual ? 1 : 0 },
    payload: entry
  }
}

function usedCommands(entries: CommandEntry[]): CommandEntry[] {
  const usage = useSearchCacheStore.getState().snapshot?.usage ?? {}
  return entries
    .filter((entry) => (usage[resultId(entry)]?.count ?? 0) > 0)
    .sort((a, b) => usage[resultId(b)].lastUsedAt - usage[resultId(a)].lastUsedAt)
    .slice(0, EMPTY_QUERY_LIMIT)
}

function compute(query: SearchQuery): SearchResult[] {
  if (!query.text) return usedCommands(buildCommandEntries(query.context)).map(toResult)
  const { bindings } = useKeybindingStore.getState()
  const { activeSessionId, activeDatabase } = query.context
  const collection = memoIndex('commands', [bindings, activeSessionId, activeDatabase], () => buildCollection(buildCommandEntries(query.context), ['title', 'keywords']))
  return searchCollection(collection, query.text, MAX_RESULTS).map(toResult)
}

export function createCommandsProvider(): SearchProvider {
  return {
    id: 'commands',
    kind: 'local',
    scopes: ['commands'],
    search: localSearch(compute),
    actions(result): SearchAction[] {
      const entry = result.payload as CommandEntry
      return [{ id: 'run', label: 'Run', role: 'primary', run: entry.run }]
    }
  }
}
