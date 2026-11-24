import { beforeEach, describe, expect, it, vi } from 'vitest'

const stored = vi.hoisted(() => {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v), removeItem: (k: string) => map.delete(k) }
  })
  return map
})

import { clearRecentFilters, forgetRecentFilters, MAX_RECENT_FILTERS, recordRecentFilter, useRecentFiltersStore } from './recentFilters'

const base = { scopeId: 's1', database: 'shop', table: 'orders', match: 'any' as const }
const paid = { ...base, filters: [{ column: 'status', operator: 'equals' as const, value: 'paid' }] }

describe('recent filters', () => {
  beforeEach(() => {
    stored.clear()
    useRecentFiltersStore.setState({ entries: [] })
  })

  it('keeps the newest first and moves a repeat to the top instead of adding it twice', () => {
    const refunded = { ...base, filters: [{ column: 'status', operator: 'equals' as const, value: 'refunded' }] }
    recordRecentFilter(paid, 1)
    recordRecentFilter(refunded, 2)
    recordRecentFilter(paid, 3)
    expect(useRecentFiltersStore.getState().entries.map((e) => [e.filters[0].value, e.at])).toEqual([
      ['paid', 3],
      ['refunded', 2]
    ])
    expect(JSON.parse(stored.get('shellway.search.recentFilters')!)).toHaveLength(2)
  })

  it('keeps at most the limit', () => {
    for (let i = 0; i < MAX_RECENT_FILTERS + 5; i++) {
      recordRecentFilter({ ...base, filters: [{ column: 'id', operator: 'equals', value: String(i) }] }, i)
    }
    expect(useRecentFiltersStore.getState().entries).toHaveLength(MAX_RECENT_FILTERS)
  })

  it('ignores an empty filter set', () => {
    recordRecentFilter({ ...base, filters: [] })
    expect(useRecentFiltersStore.getState().entries).toEqual([])
  })

  it('forgets one server, and clears them all', () => {
    recordRecentFilter(paid, 1)
    recordRecentFilter({ ...paid, scopeId: 's2' }, 2)
    forgetRecentFilters('s1')
    expect(useRecentFiltersStore.getState().entries.map((e) => e.scopeId)).toEqual(['s2'])
    clearRecentFilters()
    expect(useRecentFiltersStore.getState().entries).toEqual([])
    expect(stored.get('shellway.search.recentFilters')).toBe('[]')
  })
})
