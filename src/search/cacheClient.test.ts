import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySnapshot } from './cachePatch'
import {
  applySearchCachePatch,
  clearSearchCache,
  getUsageLookup,
  recordSelection,
  useSearchCacheStore
} from './cacheClient'
import { frequencyFromCount } from './ranking'
import type { SearchResult } from './types'

const result = (id: string): SearchResult => ({ id, providerId: 'tables', title: id, subtitle: '', icon: 'table', scoreHints: {}, payload: null })

describe('cacheClient', () => {
  const cacheGet = vi.fn()
  const cacheApply = vi.fn()
  const cacheClear = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'))
    cacheGet.mockReset().mockResolvedValue(emptySnapshot())
    cacheApply.mockReset().mockResolvedValue(undefined)
    cacheClear.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('window', { novadeck: { search: { cacheGet, cacheApply, cacheClear } } })
    useSearchCacheStore.setState({ snapshot: emptySnapshot() })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('applies a patch locally and forwards it over IPC', () => {
    applySearchCachePatch({ kind: 'paths', scopeId: 's1', paths: ['/var/www/shop/index.php'] })
    expect(useSearchCacheStore.getState().snapshot!.paths.s1).toEqual(['/var/www/shop/index.php'])
    expect(cacheApply).toHaveBeenCalledWith({ kind: 'paths', scopeId: 's1', paths: ['/var/www/shop/index.php'] })
  })

  it('swallows IPC errors', () => {
    cacheApply.mockRejectedValue(new Error('ipc down'))
    expect(() => applySearchCachePatch({ kind: 'forget', scopeId: 's1' })).not.toThrow()
  })

  it('computes recency, frequency and learned from usage', () => {
    recordSelection(result('table:s1:shop:orders'), 'ord')
    recordSelection(result('table:s1:shop:orders'), 'ord')
    const lookup = getUsageLookup()
    expect(lookup.recency('table:s1:shop:orders')).toBeCloseTo(1)
    expect(lookup.frequency('table:s1:shop:orders')).toBeCloseTo(frequencyFromCount(2))
    expect(lookup.learned('ORD', 'table:s1:shop:orders')).toBeCloseTo(2 / 3)
    expect(lookup.learned('ord', 'other')).toBe(0)
    expect(lookup.recency('unknown')).toBe(0)
  })

  it('caps the learned score at 1', () => {
    for (let i = 0; i < 5; i++) recordSelection(result('x'), 'q')
    expect(getUsageLookup().learned('q', 'x')).toBe(1)
  })

  it('decays recency with age', () => {
    recordSelection(result('x'), '')
    vi.setSystemTime(new Date('2026-01-11T12:00:00Z'))
    expect(getUsageLookup().recency('x')).toBeCloseTo(0.5)
  })

  it('clears through IPC and resets the snapshot', async () => {
    recordSelection(result('x'), 'q')
    await clearSearchCache()
    expect(cacheClear).toHaveBeenCalled()
    expect(useSearchCacheStore.getState().snapshot).toEqual(emptySnapshot())
    expect(getUsageLookup().frequency('x')).toBe(0)
  })

  it('loads once and normalises the persisted snapshot', async () => {
    vi.resetModules()
    const fresh = await import('./cacheClient')
    cacheGet.mockResolvedValue({ ...emptySnapshot(), paths: { s1: ['/srv/a.txt', 'relative.txt'] } })
    await fresh.loadSearchCache()
    await fresh.loadSearchCache()
    expect(cacheGet).toHaveBeenCalledTimes(1)
    expect(fresh.useSearchCacheStore.getState().snapshot!.paths.s1).toEqual(['/srv/a.txt'])
  })

  it('falls back to an empty snapshot when loading fails', async () => {
    vi.resetModules()
    const fresh = await import('./cacheClient')
    cacheGet.mockRejectedValue(new Error('nope'))
    await fresh.loadSearchCache()
    expect(fresh.useSearchCacheStore.getState().snapshot).toEqual(emptySnapshot())
  })
})
