import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUIStore } from '@/stores/uiStore'
import { providerInScope, providerKey, runSearch } from './broker'
import { getUsageLookup } from './cacheClient'
import { getSearchContext } from './context'
import { createProviders, enabledProviders } from './providers'
import { parseInput, type ParsedInput } from './queryParser'
import { groupResults, rankResults, type GroupedResults } from './ranking'
import { useSearchSettingsStore } from './searchSettings'
import type { ProviderId, ScopeId, SearchAction, SearchProvider, SearchQuery, SearchResult, ServerFilter } from './types'

export const PROVIDER_SCOPE: Record<ProviderId, ScopeId> = {
  sessions: 'servers',
  tables: 'tables',
  queries: 'queries',
  history: 'history',
  files: 'files',
  sites: 'sites',
  services: 'sites',
  snippets: 'commands',
  commands: 'commands',
  settings: 'settings'
}

const ALL_SCOPE_LIMIT = 3
const SCOPED_LIMIT = 50
const MIN_REMOTE_TEXT = 2

interface Snapshot {
  grouped: GroupedResults
  scopeCounts: Record<ScopeId, number>
  elapsedMs: number | null
  loading: boolean
}

const EMPTY_COUNTS: Record<ScopeId, number> = {
  all: 0,
  tables: 0,
  queries: 0,
  files: 0,
  commands: 0,
  sites: 0,
  history: 0,
  settings: 0,
  servers: 0
}

const EMPTY_SNAPSHOT: Snapshot = {
  grouped: { best: null, groups: [], total: 0 },
  scopeCounts: EMPTY_COUNTS,
  elapsedMs: null,
  loading: false
}

export interface UseSearchResult {
  input: string
  setInput: (value: string) => void
  chipScope: ScopeId
  setChipScope: (scope: ScopeId) => void
  serverFilter: ServerFilter
  setServerFilter: (filter: ServerFilter) => void
  grouped: GroupedResults
  scopeCounts: Record<ScopeId, number>
  elapsedMs: number | null
  loading: boolean
  remoteCommand: string | null
  parsed: ParsedInput
  actionsFor: (result: SearchResult) => SearchAction[]
}

function flatten(byKey: Map<string, SearchResult[]>): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const results of byKey.values()) {
    for (const result of results) {
      if (seen.has(result.id)) continue
      seen.add(result.id)
      out.push(result)
    }
  }
  return out
}

function countByScope(results: SearchResult[]): Record<ScopeId, number> {
  const counts = { ...EMPTY_COUNTS }
  for (const result of results) counts[PROVIDER_SCOPE[result.providerId]]++
  counts.all = results.length
  return counts
}

function remoteServerLabel(filter: ServerFilter): string {
  const { tabs, activeTabId } = useConnectionStore.getState()
  if (filter === 'all') return 'connected servers'
  return tabs.find((t) => t.id === activeTabId)?.sessionName ?? 'this server'
}

function describeRemote(text: string, filter: ServerFilter): string {
  return `fd -i -g '*${text}*' on ${remoteServerLabel(filter)}`
}

export function useSearch(open: boolean): UseSearchResult {
  const [input, setInput] = useState(() => useUIStore.getState().searchInitial)
  const [chipScope, setChipScopeState] = useState<ScopeId>('all')
  const [serverFilter, setServerFilter] = useState<ServerFilter>('current')
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT)
  const [remoteCommand, setRemoteCommand] = useState<string | null>(null)
  const allCountsRef = useRef<{ text: string; counts: Record<ScopeId, number> } | null>(null)

  const disabledScopes = useSearchSettingsStore((s) => s.disabledScopes)
  const providers = useMemo<SearchProvider[]>(() => enabledProviders(createProviders(), disabledScopes), [disabledScopes])
  const parsed = useMemo(() => parseInput(input, chipScope), [input, chipScope])

  useEffect(() => {
    if (!open) return
    setInput(useUIStore.getState().searchInitial)
    setChipScopeState('all')
    setServerFilter('current')
  }, [open])

  const setChipScope = useCallback(
    (scope: ScopeId) => {
      if (parsed.prefix) setInput(parsed.text)
      setChipScopeState(scope)
    },
    [parsed]
  )

  useEffect(() => {
    if (!open || parsed.prefix === '?') {
      setSnapshot(EMPTY_SNAPSHOT)
      setRemoteCommand(null)
      return
    }
    const controller = new AbortController()
    const startedAt = performance.now()
    const byKey = new Map<string, SearchResult[]>()
    const doneKeys = new Set<string>()
    const query: SearchQuery = {
      raw: input,
      text: parsed.text,
      scope: parsed.scope,
      prefix: parsed.prefix,
      serverFilter,
      context: getSearchContext()
    }
    const active = providers.filter((p) => providerInScope(p, query.scope))
    const localKeys = active.filter((p) => p.kind === 'local').map(providerKey)
    const remoteKeys = active.filter((p) => p.kind === 'remote').map(providerKey)
    const isAll = query.scope === 'all'
    let elapsedMs: number | null = localKeys.length === 0 ? 0 : null

    const publish = (loading: boolean) => {
      if (controller.signal.aborted) return
      const flat = flatten(byKey)
      const ranked = rankResults(flat, query.text, getUsageLookup())
      const grouped = groupResults(ranked, isAll ? ALL_SCOPE_LIMIT : SCOPED_LIMIT, isAll)
      const scoped = countByScope(ranked)
      if (isAll) allCountsRef.current = { text: query.text, counts: scoped }
      const known = allCountsRef.current?.text === query.text ? allCountsRef.current.counts : EMPTY_COUNTS
      const scopeCounts = isAll ? scoped : { ...known, [query.scope]: scoped.all }
      if (elapsedMs === null && localKeys.every((k) => doneKeys.has(k))) elapsedMs = Math.round(performance.now() - startedAt)
      const remoteRunning = remoteKeys.some((k) => !doneKeys.has(k))
      setRemoteCommand(remoteRunning && query.text.length >= MIN_REMOTE_TEXT ? describeRemote(query.text, serverFilter) : null)
      setSnapshot({ grouped, scopeCounts, elapsedMs, loading })
    }

    setSnapshot((prev) => ({ ...prev, loading: true }))
    void runSearch(query, providers, controller.signal, (update) => {
      byKey.set(update.key, update.results)
      if (update.done) doneKeys.add(update.key)
      publish(true)
    }).then(() => publish(false))

    return () => controller.abort()
  }, [open, input, parsed, serverFilter, providers])

  const actionsFor = useCallback(
    (result: SearchResult) => providers.find((p) => p.id === result.providerId)?.actions(result) ?? [],
    [providers]
  )

  return {
    input,
    setInput,
    chipScope,
    setChipScope,
    serverFilter,
    setServerFilter,
    grouped: snapshot.grouped,
    scopeCounts: snapshot.scopeCounts,
    elapsedMs: snapshot.elapsedMs,
    loading: snapshot.loading,
    remoteCommand,
    parsed,
    actionsFor
  }
}
