import { useSnippetStore } from '@/stores/snippetStore'
import type { Snippet } from '@/types/snippet'
import { getSearchContext } from '../context'
import { sendIntent } from '../intentStore'
import { buildCollection, memoIndex, searchCollection } from '../miniIndex'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { copyText, localSearch, MAX_RESULTS, openTabs } from './shared'

const INDEXED_FIELDS = ['name', 'shortcut', 'category']

interface SnippetEntry {
  id: string
  name: string
  shortcut: string
  category: string
  command: string
}

function toEntry(snippet: Snippet): SnippetEntry {
  return { id: snippet.id, name: snippet.name, shortcut: snippet.shortcut ?? '', category: snippet.category, command: snippet.command }
}

function toResult(entry: SnippetEntry): SearchResult {
  return {
    id: `snippet:${entry.id}`,
    providerId: 'snippets',
    title: entry.name,
    subtitle: entry.category ? `snippet · ${entry.category}` : 'snippet',
    icon: 'snippet',
    hint: entry.shortcut || undefined,
    keywords: `${entry.shortcut} ${entry.category}`,
    scoreHints: {},
    payload: { command: entry.command }
  }
}

function compute(query: SearchQuery): SearchResult[] {
  if (!query.text) return []
  const { snippets } = useSnippetStore.getState()
  const collection = memoIndex('snippets', [snippets], () => buildCollection(snippets.map(toEntry), INDEXED_FIELDS))
  return searchCollection(collection, query.text, MAX_RESULTS).map(toResult)
}

function activeSshSessionId(): string | null {
  const { activeTabId } = getSearchContext()
  const tab = openTabs().find((t) => t.id === activeTabId)
  return tab && tab.type !== 'database' ? tab.sessionId : null
}

export function createSnippetsProvider(): SearchProvider {
  return {
    id: 'snippets',
    kind: 'local',
    scopes: ['commands'],
    search: localSearch(compute),
    actions(result): SearchAction[] {
      const { command } = result.payload as { command: string }
      const sessionId = activeSshSessionId()
      const actions: SearchAction[] = []
      if (sessionId) {
        actions.push({
          id: 'insert',
          label: 'Insert in terminal',
          role: 'primary',
          run: () => sendIntent(sessionId, { kind: 'terminal-insert', text: command })
        })
      }
      actions.push({ id: 'copy', label: 'Copy command', role: sessionId ? 'copy' : 'primary', run: () => copyText(command) })
      return actions
    }
  }
}
