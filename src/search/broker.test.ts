import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { providerInScope, runSearch, type ProviderUpdate } from './broker'
import type { ProviderId, SearchProvider, SearchQuery, SearchResult } from './types'

const query: SearchQuery = {
  raw: 'ord',
  text: 'ord',
  scope: 'all',
  prefix: null,
  serverFilter: 'all',
  wholeServer: false,
  context: { activeTabId: null, activeSessionId: null, activeDatabase: null, activeSite: null, connectedTabIds: [] }
}

function result(id: string, providerId: ProviderId = 'tables'): SearchResult {
  return { id, providerId, title: id, subtitle: '', icon: 'table', scoreHints: {}, payload: null }
}

function provider(id: ProviderId, search: SearchProvider['search'], kind: SearchProvider['kind'] = 'local'): SearchProvider {
  return { id, kind, scopes: [id === 'files' ? 'files' : 'tables'], search, actions: () => [] }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    })
  })
}

describe('runSearch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('streams batches and reports done', async () => {
    const updates: ProviderUpdate[] = []
    const p = provider('tables', async function* () {
      yield [result('a')]
      yield [result('b')]
    })
    await runSearch(query, [p], new AbortController().signal, (u) => updates.push(u))
    expect(updates.map((u) => [u.results.map((r) => r.id), u.done])).toEqual([
      [['a'], false],
      [['a', 'b'], false],
      [['a', 'b'], true]
    ])
  })

  it('never reports results after the search is cancelled', async () => {
    const updates: ProviderUpdate[] = []
    const controller = new AbortController()
    const p = provider('tables', async function* (_q, signal) {
      yield [result('first')]
      await delay(100, signal)
      yield [result('stale')]
    })
    const run = runSearch(query, [p], controller.signal, (u) => updates.push(u))
    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    await vi.advanceTimersByTimeAsync(200)
    await run
    expect(updates.flatMap((u) => u.results.map((r) => r.id))).not.toContain('stale')
    expect(updates.every((u) => !u.done)).toBe(true)
  })

  it('stops a provider that exceeds its budget and marks it timed out', async () => {
    const updates: ProviderUpdate[] = []
    const p = provider('tables', async function* () {
      yield [result('quick')]
      await new Promise(() => {})
    })
    const run = runSearch(query, [p], new AbortController().signal, (u) => updates.push(u), { localMs: 50, remoteMs: 1000 })
    await vi.advanceTimersByTimeAsync(60)
    await run
    const last = updates.at(-1)!
    expect(last).toMatchObject({ done: true, timedOut: true })
    expect(last.results.map((r) => r.id)).toEqual(['quick'])
  })

  it('reports provider errors without failing other providers', async () => {
    const updates: ProviderUpdate[] = []
    const broken = provider('tables', async function* () {
      throw new Error('boom')
    })
    const ok = { ...provider('queries', async function* () { yield [result('q', 'queries')] }), scopes: ['tables' as const] }
    await runSearch(query, [broken, ok], new AbortController().signal, (u) => updates.push(u))
    expect(updates.find((u) => u.providerId === 'tables')).toMatchObject({ done: true, error: 'boom' })
    expect(updates.find((u) => u.providerId === 'queries' && u.done)?.results).toHaveLength(1)
  })
})

describe('providerInScope', () => {
  const local = provider('tables', async function* () {})
  const remote = provider('files', async function* () {}, 'remote')

  it('runs only local providers for All', () => {
    expect(providerInScope(local, 'all')).toBe(true)
    expect(providerInScope(remote, 'all')).toBe(false)
  })

  it('runs remote providers when their scope is chosen', () => {
    expect(providerInScope(remote, 'files')).toBe(true)
    expect(providerInScope(local, 'files')).toBe(false)
  })
})
