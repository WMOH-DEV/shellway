import { beforeEach, describe, expect, it } from 'vitest'
import type { SQLTab } from '@/types/sql'
import { getSQLConnectionState, useSQLStore } from './sqlStore'
import { useSqlTabSettingsStore } from './sqlTabSettingsStore'

const CONN = 'conn-1'

const table = (id: string): SQLTab => ({ id, type: 'data', label: id, table: id, database: 'shop_db' })
const ids = (): string[] => getSQLConnectionState(CONN).tabs.map((t) => t.id)

describe('sqlStore tabs', () => {
  beforeEach(() => {
    useSQLStore.getState().removeConnection(CONN)
    useSqlTabSettingsStore.setState({ sqlTabLimit: 2, sqlNewTabPosition: 'end' })
  })

  it('addTab closes the least recently used tab past the limit', () => {
    const store = useSQLStore.getState()
    store.addTab(CONN, table('a'))
    store.addTab(CONN, table('b'))
    store.addTab(CONN, table('c'))
    expect(ids()).toEqual(['b', 'c'])
    expect(getSQLConnectionState(CONN).closedTabs[0].tab.id).toBe('a')
  })

  it('never evicts a data tab with staged changes', () => {
    const store = useSQLStore.getState()
    store.addTab(CONN, table('a'))
    store.addStagedChange(CONN, { id: 'ch1', type: 'update', table: 'a', tabId: 'a' })
    store.addTab(CONN, table('b'))
    store.addTab(CONN, table('c'))
    expect(ids()).toEqual(['a', 'c'])
  })

  it('flags going over the limit when nothing can close', () => {
    const store = useSQLStore.getState()
    store.addTab(CONN, table('a'))
    store.setTabPinned(CONN, 'a', true)
    store.addTab(CONN, table('b'))
    store.setTabPinned(CONN, 'b', true)
    store.addTab(CONN, table('c'))
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(getSQLConnectionState(CONN).tabsOverLimit).toBe(true)
  })

  it('removeTab feeds the reopen stack', () => {
    const store = useSQLStore.getState()
    store.addTab(CONN, table('a'))
    store.addTab(CONN, table('b'))
    store.removeTab(CONN, 'b')
    store.reopenClosedTab(CONN)
    expect(ids()).toEqual(['a', 'b'])
    expect(getSQLConnectionState(CONN).activeTabId).toBe('b')
  })

  it('restoreTabs sets saved state without evicting', () => {
    useSQLStore.getState().restoreTabs(CONN, {
      tabs: [table('a'), table('b'), table('c')],
      activeTabId: 'b'
    })
    const conn = getSQLConnectionState(CONN)
    expect(ids()).toEqual(['a', 'b', 'c'])
    expect(conn.mru).toEqual(['b'])
    expect(conn.closedTabs).toEqual([])
  })
})
