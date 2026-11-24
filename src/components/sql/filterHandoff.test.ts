import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableFilter } from '@/types/sql'
import { HANDOFF_TTL_MS, handoffFor, handoffKey, mergeHandoff, rowKeyColumn, useFilterHandoffStore } from './filterHandoff'

const filter = (id: string, column: string, value: string, enabled = true): TableFilter => ({ id, column, operator: 'contains', value, enabled })

function ids(): () => string {
  let n = 0
  return () => `new${++n}`
}

describe('mergeHandoff', () => {
  it('adds a filter with no value and asks to focus it, leaving the others as they were', () => {
    const current = [filter('a', 'status', 'draft')]
    const merged = mergeHandoff(current, [{ column: 'title', operator: 'contains', value: '' }], ids())
    expect(merged).toEqual({ filters: [current[0], filter('new1', 'title', '')], focusId: 'new1', apply: false })
  })

  it('replaces the filter on the same column, applies it, and turns the others off', () => {
    const current = [filter('a', 'title', 'alpha'), filter('b', 'status', 'draft')]
    const merged = mergeHandoff(current, [{ column: 'title', operator: 'equals', value: 'beta' }], ids())
    expect(merged.apply).toBe(true)
    expect(merged.focusId).toBeNull()
    expect(merged.filters).toEqual([
      { id: 'new1', column: 'title', operator: 'equals', value: 'beta', enabled: true },
      filter('b', 'status', 'draft', false)
    ])
  })

  it('counts a null check as ready to apply', () => {
    expect(mergeHandoff([], [{ column: 'deleted_at', operator: 'is_null', value: '' }], ids()).apply).toBe(true)
  })

  it('keeps two incoming filters on the same column apart', () => {
    const merged = mergeHandoff(
      [filter('a', 'price', '1')],
      [
        { column: 'price', operator: 'greater_than', value: '1' },
        { column: 'price', operator: 'less_than', value: '5' }
      ],
      ids()
    )
    expect(merged.filters.map((f) => [f.id, f.operator])).toEqual([
      ['new1', 'greater_than'],
      ['new2', 'less_than']
    ])
  })
})

describe('filter handoff store', () => {
  beforeEach(() => useFilterHandoffStore.setState({ pending: {} }))

  it('hands a filter over once', () => {
    const key = handoffKey('c1', 'shop', 'orders')
    const handoff = { filters: [{ column: 'status', operator: 'equals' as const, value: 'paid' }] }
    useFilterHandoffStore.getState().push(key, handoff, 1000)
    expect(useFilterHandoffStore.getState().take(key, 1000)).toEqual(handoff)
    expect(useFilterHandoffStore.getState().take(key, 1000)).toBeNull()
  })

  it('drops a handoff nobody picked up in time', () => {
    const key = handoffKey('c1', 'shop', 'orders')
    useFilterHandoffStore.getState().push(key, { filters: [] }, 1000)
    expect(useFilterHandoffStore.getState().take(key, 1000 + HANDOFF_TTL_MS + 1)).toBeNull()
    expect(useFilterHandoffStore.getState().pending).toEqual({})
  })
})

describe('handoffFor', () => {
  it('passes filters through and turns a row lookup into a key filter', async () => {
    const filters = [{ column: 'status', operator: 'equals' as const, value: 'paid' }]
    expect(await handoffFor({ kind: 'filters', filters, match: 'all' }, async () => null)).toEqual({ filters, match: 'all' })
    expect(await handoffFor({ kind: 'row', value: '42' }, async () => 'order_id')).toEqual({
      filters: [{ column: 'order_id', operator: 'equals', value: '42' }]
    })
    expect(await handoffFor({ kind: 'row', value: '42' }, async () => null)).toBeNull()
  })
})

describe('rowKeyColumn', () => {
  const column = (name: string, isPrimaryKey: boolean) => ({ name, isPrimaryKey })
  const stubStructure = (result: unknown) =>
    vi.stubGlobal('window', { novadeck: { sql: { getTableStructure: vi.fn(async () => result) } } })

  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['the single primary key', [column('uuid', true), column('id', false)], 'uuid'],
    ['id when the key has two columns', [column('id', true), column('tenant', true)], 'id'],
    ['id when there is no key', [column('id', false)], 'id'],
    ['nothing without a key or id', [column('name', false)], null]
  ])('picks %s', async (_label, columns, expected) => {
    stubStructure({ success: true, data: { columns } })
    expect(await rowKeyColumn('sql-1', 'orders')).toBe(expected)
  })

  it('gives nothing when the structure cannot be read', async () => {
    stubStructure({ success: false, error: 'gone' })
    expect(await rowKeyColumn('sql-1', 'orders')).toBeNull()
    vi.stubGlobal('window', { novadeck: { sql: { getTableStructure: vi.fn(async () => Promise.reject(new Error('closed'))) } } })
    expect(await rowKeyColumn('sql-1', 'orders')).toBeNull()
  })
})
