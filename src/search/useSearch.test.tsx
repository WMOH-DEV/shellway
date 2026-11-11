import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/stores/uiStore'
import type { ScopeId, SearchProvider, SearchQuery, SearchResult } from './types'

const providerState: { providers: SearchProvider[] } = { providers: [] }

vi.mock('./providers', () => ({
  createProviders: () => providerState.providers,
  enabledProviders: (providers: SearchProvider[]) => providers
}))

import { useSearch } from './useSearch'

function result(id: string, providerId: SearchResult['providerId'], title: string): SearchResult {
  return { id, providerId, title, subtitle: '', icon: 'table', scoreHints: {}, payload: null }
}

function provider(
  id: SearchProvider['id'],
  scopes: ScopeId[],
  search: (query: SearchQuery, signal: AbortSignal) => AsyncIterable<SearchResult[]>
): SearchProvider {
  return { id, kind: 'local', scopes, search, actions: () => [] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  useUIStore.setState({ searchOpen: true, searchInitial: '' })
  providerState.providers = []
})

describe('useSearch', () => {
  it('ignores results of an older input that finish after a newer one', async () => {
    const slow = deferred<SearchResult[]>()
    providerState.providers = [
      provider('tables', ['tables'], async function* (query) {
        if (query.text === 'or') yield await slow.promise
        else yield [result('table:s:db:orders', 'tables', 'orders')]
      })
    ]
    const { result: hook } = renderHook(() => useSearch(true))

    act(() => hook.current.setInput('or'))
    act(() => hook.current.setInput('orders'))
    await waitFor(() => expect(hook.current.grouped.total).toBe(1))

    await act(async () => {
      slow.resolve([result('table:s:db:old', 'tables', 'order_old')])
      await Promise.resolve()
    })

    const titles = [hook.current.grouped.best, ...hook.current.grouped.groups.flatMap((g) => g.results)].filter(Boolean).map((r) => r!.title)
    expect(titles).toEqual(['orders'])
  })

  it('switches scope for a prefix and skips providers outside it', async () => {
    const tables = vi.fn(async function* () {
      yield [result('table:s:db:orders', 'tables', 'orders')]
    })
    const files = vi.fn(async function* () {
      yield [result('file:s:/a/orders.php', 'files', 'orders.php')]
    })
    providerState.providers = [provider('tables', ['tables'], tables), provider('files', ['files'], files)]
    const { result: hook } = renderHook(() => useSearch(true))
    await waitFor(() => expect(tables).toHaveBeenCalled())
    tables.mockClear()
    files.mockClear()

    act(() => hook.current.setInput('#orders'))

    await waitFor(() => expect(hook.current.grouped.total).toBe(1))
    expect(hook.current.parsed.scope).toBe('tables')
    expect(hook.current.parsed.text).toBe('orders')
    expect(files).not.toHaveBeenCalled()
  })

  it('does not run any provider for the text in files prefix', async () => {
    const files = vi.fn(async function* () {
      yield [result('file:s:/a/orders.php', 'files', 'orders.php')]
    })
    providerState.providers = [provider('files', ['files'], files)]
    const { result: hook } = renderHook(() => useSearch(true))
    await waitFor(() => expect(files).toHaveBeenCalled())
    files.mockClear()

    act(() => hook.current.setInput('?OrderRefunded'))

    expect(hook.current.parsed.prefix).toBe('?')
    expect(hook.current.grouped.total).toBe(0)
    expect(files).not.toHaveBeenCalled()
  })

  it('shows one row when two providers return the same id', async () => {
    const same = result('file:s:/a/orders.php', 'files', 'orders.php')
    providerState.providers = [
      provider('files', ['files'], async function* () {
        yield [same]
      }),
      provider('tables', ['tables'], async function* () {
        yield [{ ...same, providerId: 'tables' }]
      })
    ]
    const { result: hook } = renderHook(() => useSearch(true))

    act(() => hook.current.setInput('orders'))

    await waitFor(() => expect(hook.current.grouped.total).toBe(1))
  })

  it('starts from the initial text and clears a typed prefix when a chip is picked', async () => {
    useUIStore.setState({ searchInitial: '#orders' })
    const { result: hook } = renderHook(() => useSearch(true))
    expect(hook.current.input).toBe('#orders')

    act(() => hook.current.setChipScope('files'))

    expect(hook.current.input).toBe('orders')
    expect(hook.current.parsed.scope).toBe('files')
  })

  it('reports counts per scope for the all view', async () => {
    providerState.providers = [
      provider('tables', ['tables'], async function* () {
        yield [result('table:s:db:orders', 'tables', 'orders'), result('table:s:db:order_items', 'tables', 'order_items')]
      }),
      provider('history', ['history'], async function* () {
        yield [result('history:s:1', 'history', 'select orders')]
      })
    ]
    const { result: hook } = renderHook(() => useSearch(true))

    act(() => hook.current.setInput('order'))

    await waitFor(() => expect(hook.current.scopeCounts.tables).toBe(2))
    expect(hook.current.scopeCounts.history).toBe(1)
    expect(hook.current.scopeCounts.all).toBe(3)
  })
})
