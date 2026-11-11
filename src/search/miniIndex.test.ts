import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCollection, clearMemoIndexes, createIndex, memoIndex, searchCollection, searchIndex } from './miniIndex'

interface Doc {
  id: string
  name: string
  note?: string
}

describe('miniIndex', () => {
  beforeEach(() => clearMemoIndexes())

  it('matches prefixes and tolerates a small typo', () => {
    const index = createIndex<Doc>(['name'])
    index.addAll([{ id: '1', name: 'orders' }, { id: '2', name: 'customers' }])
    expect(searchIndex(index, 'ord', 10)).toEqual(['1'])
    expect(searchIndex(index, 'custmers', 10)).toEqual(['2'])
  })

  it('requires every term to match', () => {
    const index = createIndex<Doc>(['name'])
    index.addAll([{ id: '1', name: 'order items' }, { id: '2', name: 'order refunds' }])
    expect(searchIndex(index, 'order items', 10)).toEqual(['1'])
  })

  it('splits snake and camel case into searchable words', () => {
    const index = createIndex<Doc>(['name'])
    index.addAll([{ id: '1', name: 'order_items' }, { id: '2', name: 'OrderRefunds' }])
    expect(searchIndex(index, 'items', 10)).toEqual(['1'])
    expect(searchIndex(index, 'refunds', 10)).toEqual(['2'])
    expect(searchIndex(index, 'orderrefunds', 10)).toEqual(['2'])
  })

  it('searches only the indexed fields', () => {
    const collection = buildCollection<Doc>([{ id: '1', name: 'alpha', note: 'secret' }], ['name'])
    expect(searchCollection(collection, 'secret', 10)).toEqual([])
    expect(searchCollection(collection, 'alpha', 10)).toHaveLength(1)
  })

  it('applies the limit and returns nothing for punctuation only', () => {
    const docs = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `log ${i}` }))
    const collection = buildCollection(docs, ['name'])
    expect(searchCollection(collection, 'log', 5)).toHaveLength(5)
    expect(searchCollection(collection, '...', 5)).toEqual([])
  })

  it('rebuilds a memoised collection only when a dependency changes', () => {
    const build = vi.fn(() => buildCollection<Doc>([{ id: '1', name: 'a' }], ['name']))
    const source = [1]
    const first = memoIndex('k', [source], build)
    expect(memoIndex('k', [source], build)).toBe(first)
    expect(build).toHaveBeenCalledTimes(1)
    memoIndex('k', [[1]], build)
    expect(build).toHaveBeenCalledTimes(2)
  })
})
