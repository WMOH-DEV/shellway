import { useSessionStore } from '@/stores/sessionStore'
import { useSFTPPathStore } from '@/stores/sftpPathStore'
import type { RemoteSearchEvent } from '@/types/search'
import type { ConnectionTab } from '@/types/session'
import { useSearchCacheStore } from '../cacheClient'
import { getSearchSettings } from '../searchSettings'
import type { SearchProvider, SearchQuery, SearchResult } from '../types'
import { fileActions, toFileResult } from './fileResult'
import { setRemoteSearchStatus } from './remoteStatus'
import { AsyncQueue, delay, mergeStreams, MAX_RESULTS, openTabs } from './shared'

const MIN_TEXT_LENGTH = 2
const DEBOUNCE_MS = 250
const MAX_TARGETS = 3
const SERVER_ROOT = '/'
const HOME_FOLDER = '~'

interface Target {
  tab: ConnectionTab
  root: string | null
}

function isAbsolute(path: string | undefined): path is string {
  return !!path && path.startsWith('/')
}

function rootFor(tab: ConnectionTab, activeSite: string | null): string | null {
  const stored = useSFTPPathStore.getState().paths[`${tab.sessionId}:remote`]
  if (isAbsolute(stored)) return stored
  const siteRoot = useSearchCacheStore.getState().snapshot?.servers[tab.sessionId]?.sites.find((s) => s.name === activeSite)?.root
  if (isAbsolute(siteRoot)) return siteRoot
  const fallback = useSessionStore.getState().sessions.find((s) => s.id === tab.sessionId)?.defaultDirectory
  return isAbsolute(fallback) ? fallback : null
}

function pickTargets(query: SearchQuery): Target[] {
  const { activeTabId, activeSite, connectedTabIds } = query.context
  const connected = openTabs().filter((tab) => tab.type !== 'database' && connectedTabIds.includes(tab.id))
  const candidates = query.serverFilter === 'current' ? connected.filter((tab) => tab.id === activeTabId) : connected
  return candidates.slice(0, MAX_TARGETS).map((tab) => ({ tab, root: query.wholeServer ? SERVER_ROOT : rootFor(tab, activeSite) }))
}

async function* searchTarget(target: Target, query: SearchQuery, signal: AbortSignal): AsyncGenerator<SearchResult[]> {
  const api = window.novadeck.search
  const events = new AsyncQueue<RemoteSearchEvent>()
  const unsubscribe = api.onEvent((event) => events.push(event))
  let searchId: string | null = null
  let finished = false
  try {
    const started = await api
      .findFiles({ connectionId: target.tab.id, root: target.root ?? undefined, text: query.text, excludes: getSearchSettings().excludeGlobs })
      .catch(() => null)
    if (!started) return
    searchId = started.searchId
    setRemoteSearchStatus({ command: started.command })
    for (;;) {
      const event = await events.pull(signal)
      if (!event) return
      if (event.searchId !== searchId) continue
      if (event.kind === 'done') {
        finished = true
        return
      }
      if (event.kind === 'files') yield event.paths.map((path) => toFileResult(path, target.tab.sessionId, query))
    }
  } finally {
    unsubscribe()
    if (searchId && !finished) void api.cancel(searchId).catch(() => {})
  }
}

function linkedController(parent: AbortSignal): AbortController {
  const child = new AbortController()
  if (parent.aborted) child.abort()
  else parent.addEventListener('abort', () => child.abort(), { once: true })
  return child
}

async function* mergedTargets(targets: Target[], query: SearchQuery, signal: AbortSignal): AsyncGenerator<SearchResult[]> {
  let remaining = MAX_RESULTS
  for await (const batch of mergeStreams(targets.map((target) => searchTarget(target, query, signal)))) {
    if (signal.aborted) return
    const slice = batch.slice(0, remaining)
    remaining -= slice.length
    if (slice.length > 0) yield slice
    if (remaining <= 0) return
  }
}

function announce(targets: Target[]): void {
  const several = targets.length > 1
  setRemoteSearchStatus({
    server: several ? `${targets.length} servers` : targets[0].tab.sessionName,
    folder: several ? null : targets[0].root ?? HOME_FOLDER
  })
}

async function* search(query: SearchQuery, signal: AbortSignal): AsyncGenerator<SearchResult[]> {
  if (query.text.length < MIN_TEXT_LENGTH) return
  const targets = pickTargets(query)
  if (targets.length === 0) return
  announce(targets)
  await delay(DEBOUNCE_MS, signal)
  if (signal.aborted) return
  const controller = linkedController(signal)
  try {
    yield* mergedTargets(targets, query, controller.signal)
  } finally {
    controller.abort()
  }
}

export function createRemoteFilesProvider(): SearchProvider {
  return { id: 'files', kind: 'remote', scopes: ['files'], search, actions: fileActions }
}
