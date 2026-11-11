import { describe, expect, it } from 'vitest'
import type { SQLTab } from '@/types/sql'
import { scopeCounts, searchTabs, tabInScope } from './tabSearch'

const make = (patch: Partial<SQLTab> & Pick<SQLTab, 'id'>): SQLTab => ({
  type: 'data',
  label: patch.id,
  ...patch
})

const orders = make({ id: 'orders', table: 'orders', database: 'shop_db' })
const payments = make({ id: 'payments', table: 'payments', database: 'shop_db' })
const ordersStructure = make({ id: 'orders-structure', label: 'orders', type: 'structure', database: 'shop_db' })
const users = make({ id: 'users', table: 'users', database: 'auth_db' })
const report = make({ id: 'report', type: 'query', label: 'Query 1', isDirty: true })
const tabs = [orders, payments, ordersStructure, users, report]
const noFilters = {}

const ids = (list: SQLTab[]): string[] => list.map((t) => t.id)

describe('tabInScope', () => {
  it('all keeps every tab', () => {
    expect(tabs.every((t) => tabInScope(t, 'all'))).toBe(true)
  })

  it('tables keeps table and structure tabs', () => {
    expect(ids(tabs.filter((t) => tabInScope(t, 'tables')))).toEqual(['orders', 'payments', 'orders-structure', 'users'])
  })

  it('queries keeps query tabs', () => {
    expect(ids(tabs.filter((t) => tabInScope(t, 'queries')))).toEqual(['report'])
  })

  it('unsaved keeps dirty tabs', () => {
    expect(ids(tabs.filter((t) => tabInScope(t, 'unsaved')))).toEqual(['report'])
  })
})

describe('searchTabs', () => {
  it('returns everything for an empty query and keeps the given order', () => {
    expect(ids(searchTabs([users, orders, report], '', 'all', noFilters))).toEqual(['users', 'orders', 'report'])
  })

  it('matches the title', () => {
    expect(ids(searchTabs(tabs, 'pay', 'all', noFilters))).toEqual(['payments'])
  })

  it('matches the database name', () => {
    expect(ids(searchTabs(tabs, 'auth', 'all', noFilters))).toEqual(['users'])
  })

  it('matches the kind label', () => {
    expect(ids(searchTabs(tabs, 'query', 'all', noFilters))).toEqual(['report'])
  })

  it('matches the filter text', () => {
    const filters = { payments: 'status = failed' }
    expect(ids(searchTabs(tabs, 'failed', 'all', filters))).toEqual(['payments'])
  })

  it('applies scope before the query', () => {
    expect(ids(searchTabs(tabs, 'orders', 'tables', noFilters))).toEqual(['orders', 'orders-structure'])
    expect(searchTabs(tabs, 'orders', 'queries', noFilters)).toEqual([])
  })
})

describe('scopeCounts', () => {
  it('counts tabs per scope', () => {
    expect(scopeCounts(tabs)).toEqual({ all: 5, tables: 4, queries: 1, unsaved: 1 })
  })

  it('counts nothing for no tabs', () => {
    expect(scopeCounts([])).toEqual({ all: 0, tables: 0, queries: 0, unsaved: 0 })
  })
})
