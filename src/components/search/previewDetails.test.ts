import { describe, expect, it } from 'vitest'
import type { SearchCacheSnapshot } from '@/types/search'
import type { SearchResult } from '@/search/types'
import { describeResult } from './previewDetails'

const snapshot: SearchCacheSnapshot = {
  version: 1,
  tables: { s1: { shop: [{ name: 'orders', type: 'table', columns: ['id', 'status'] }] } },
  servers: {},
  paths: {},
  usage: {},
  learned: {}
}

function result(id: string, providerId: SearchResult['providerId'], extra: Partial<SearchResult> = {}): SearchResult {
  return { id, providerId, title: 'title', subtitle: 'deploy@shop.example.com:22 · Main', icon: 'table', scoreHints: {}, payload: null, ...extra }
}

describe('describeResult', () => {
  it('lists the cached columns of a table', () => {
    expect(describeResult(result('table:s1:shop:orders', 'tables'), snapshot)).toEqual({ kind: 'columns', columns: ['id', 'status'] })
  })

  it('finds the table of a column result', () => {
    expect(describeResult(result('column:s1:shop:orders.status', 'tables'), snapshot)).toEqual({ kind: 'columns', columns: ['id', 'status'] })
  })

  it('shows nothing when the table is not cached', () => {
    expect(describeResult(result('table:s1:shop:missing', 'tables'), snapshot)).toEqual({ kind: 'none' })
  })

  it('shows the sql of a history entry, falling back to the title', () => {
    expect(describeResult(result('history:s1:9', 'history', { payload: { sql: 'SELECT 1' } }), null)).toEqual({ kind: 'code', text: 'SELECT 1' })
    expect(describeResult(result('history:s1:9', 'history'), null)).toEqual({ kind: 'code', text: 'title' })
  })

  it('shows the full path of a file', () => {
    expect(describeResult(result('file:s1:/var/www/shop/app/Order.php', 'files'), null)).toEqual({
      kind: 'text',
      text: '/var/www/shop/app/Order.php'
    })
  })

  it('shows user and host of a server', () => {
    expect(describeResult(result('session:s1', 'sessions'), null)).toEqual({ kind: 'text', text: 'deploy@shop.example.com:22' })
  })
})
