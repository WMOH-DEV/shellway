import { describe, expect, it } from 'vitest'
import type { SQLTab } from '@/types/sql'
import { buildGroups, type VerticalRow } from './verticalGroups'

function tab(id: string, patch: Partial<SQLTab> = {}): SQLTab {
  return { id, type: 'data', label: id, database: 'shop_db', ...patch }
}

const tabs: SQLTab[] = [
  tab('orders', { pinned: true }),
  tab('users', { database: 'auth_db' }),
  tab('products'),
  tab('revenue', { type: 'query', database: undefined }),
  tab('orders-structure', { type: 'structure' }),
  tab('sessions', { database: 'auth_db' })
]

const none = new Set<string>()

function groupLabels(rows: VerticalRow[]): string[] {
  return rows.flatMap((r) => (r.type === 'group' ? [r.label] : []))
}

function tabIds(rows: VerticalRow[]): string[] {
  return rows.flatMap((r) => (r.type === 'tab' ? [r.tab.id] : []))
}

describe('buildGroups', () => {
  it('puts pinned tabs in the first group regardless of database', () => {
    const rows = buildGroups(tabs, 'database', '', none)
    expect(rows[0]).toMatchObject({ type: 'group', key: 'pinned', label: 'Pinned', count: 1 })
    expect(rows[1]).toMatchObject({ type: 'tab', tab: { id: 'orders' } })
  })

  it('sorts database groups and puts "No database" last', () => {
    const rows = buildGroups(tabs, 'database', '', none)
    expect(groupLabels(rows)).toEqual(['Pinned', 'auth_db', 'shop_db', 'No database'])
    expect(rows.filter((r) => r.type === 'group').map((r) => r.key)).toEqual([
      'pinned',
      'db:auth_db',
      'db:shop_db',
      'db:'
    ])
  })

  it('keeps the original tab order inside a group', () => {
    expect(tabIds(buildGroups(tabs, 'database', '', none))).toEqual([
      'orders',
      'users',
      'sessions',
      'products',
      'orders-structure',
      'revenue'
    ])
  })

  it('groups by kind in kind mode and omits empty groups', () => {
    const rows = buildGroups(tabs, 'kind', '', none)
    expect(groupLabels(rows)).toEqual(['Pinned', 'Tables', 'Queries', 'Structure'])
    expect(rows.filter((r) => r.type === 'group').map((r) => r.key)).toEqual([
      'pinned',
      'kind:table',
      'kind:query',
      'kind:structure'
    ])
    const noQueries = tabs.filter((t) => t.type !== 'query')
    expect(groupLabels(buildGroups(noQueries, 'kind', '', none))).toEqual(['Pinned', 'Tables', 'Structure'])
  })

  it('hides rows of a collapsed group but keeps its count', () => {
    const rows = buildGroups(tabs, 'database', '', new Set(['db:auth_db']))
    const header = rows.find((r) => r.type === 'group' && r.key === 'db:auth_db')
    expect(header).toMatchObject({ count: 2, collapsed: true })
    expect(tabIds(rows)).not.toContain('users')
    expect(tabIds(rows)).not.toContain('sessions')
    expect(tabIds(rows)).toContain('products')
  })

  it('narrows by filter and drops empty groups', () => {
    const rows = buildGroups(tabs, 'database', 'sess', none)
    expect(groupLabels(rows)).toEqual(['auth_db'])
    expect(tabIds(rows)).toEqual(['sessions'])
  })

  it('matches the database name in the filter', () => {
    expect(tabIds(buildGroups(tabs, 'database', 'auth_db', none))).toEqual(['users', 'sessions'])
  })

  it('reports each tab index as its position in the original array', () => {
    const rows = buildGroups(tabs, 'database', '', none)
    const indexById = Object.fromEntries(rows.flatMap((r) => (r.type === 'tab' ? [[r.tab.id, r.index]] : [])))
    expect(indexById).toEqual({
      orders: 0,
      users: 1,
      products: 2,
      revenue: 3,
      'orders-structure': 4,
      sessions: 5
    })
  })
})
