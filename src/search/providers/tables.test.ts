import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSQLStore } from '@/stores/sqlStore'
import type { SchemaColumn } from '@/types/sql'
import { applyPatch } from '../cachePatch'
import { useSearchCacheStore } from '../cacheClient'
import { useSearchIntentStore } from '../intentStore'
import { createTablesProvider } from './tables'
import { collect, EMPTY_CONTEXT, makeQuery, makeSession, makeTab, resetSearchState, stubBrowser } from './testHelpers'

const column = (name: string, tableName: string): SchemaColumn => ({
  name,
  tableName,
  type: 'varchar',
  nullable: false,
  defaultValue: null,
  isPrimaryKey: false,
  isAutoIncrement: false
})

function seedLiveShop(): void {
  useSessionStore.setState({ sessions: [makeSession({ id: 's1', name: 'Shop server' })] })
  useConnectionStore.setState({ tabs: [makeTab({ id: 't1', sessionId: 's1' })], activeTabId: 't1' })
  const sql = useSQLStore.getState()
  sql.setCurrentDatabase('t1', 'shop')
  sql.setTables('t1', [
    { name: 'orders', type: 'table' },
    { name: 'order_items', type: 'table' },
    { name: 'customers', type: 'table' }
  ])
  sql.setColumns('t1', [column('status', 'orders'), column('email', 'customers')])
}

const activeContext = { ...EMPTY_CONTEXT, activeTabId: 't1', activeSessionId: 's1', activeDatabase: 'shop', connectedTabIds: ['t1'] }

describe('tables provider', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = stubBrowser().writeText
    resetSearchState()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('finds live tables and columns with the documented subtitles', async () => {
    seedLiveShop()
    const results = await collect(createTablesProvider(), makeQuery('orders'))
    const table = results.find((r) => r.id === 'table:s1:shop:orders')!
    expect(table.subtitle).toBe('table · shop · Shop server')
    expect(table.icon).toBe('table')

    const columns = await collect(createTablesProvider(), makeQuery('status'))
    const col = columns.find((r) => r.id === 'column:s1:shop:orders.status')!
    expect(col.subtitle).toBe('column · orders · shop')
    expect(col.icon).toBe('column')
  })

  it('splits snake case names so a later word matches', async () => {
    seedLiveShop()
    const results = await collect(createTablesProvider(), makeQuery('items'))
    expect(results.map((r) => r.id)).toContain('table:s1:shop:order_items')
  })

  it('reads the cache when no live connection exists and marks it disconnected', async () => {
    useSearchCacheStore.setState({
      snapshot: applyPatch(
        useSearchCacheStore.getState().snapshot!,
        { kind: 'tables', scopeId: 's9', database: 'blog', tables: [{ name: 'posts', type: 'table', columns: ['title'] }] },
        1
      )
    })
    const [post] = await collect(createTablesProvider(), makeQuery('posts'))
    expect(post.id).toBe('table:s9:blog:posts')
    expect(post.hint).toBe('disconnected')
    expect(post.scoreHints.disconnected).toBe(true)
  })

  it('prefers live data over the cached copy of the same database', async () => {
    seedLiveShop()
    useSearchCacheStore.setState({
      snapshot: applyPatch(
        useSearchCacheStore.getState().snapshot!,
        { kind: 'tables', scopeId: 's1', database: 'shop', tables: [{ name: 'dropped_table', type: 'table', columns: [] }] },
        1
      )
    })
    expect(await collect(createTablesProvider(), makeQuery('dropped'))).toEqual([])
  })

  it('boosts the active session and database', async () => {
    seedLiveShop()
    const same = (await collect(createTablesProvider(), makeQuery('orders', { context: activeContext })))[0]
    expect(same.scoreHints.context).toBe(1)
    const other = (await collect(createTablesProvider(), makeQuery('orders', { context: { ...activeContext, activeDatabase: 'other' } })))[0]
    expect(other.scoreHints.context).toBe(0.5)
    const elsewhere = (await collect(createTablesProvider(), makeQuery('orders')))[0]
    expect(elsewhere.scoreHints.context).toBe(0)
  })

  it('suggests tables of the active database on an empty query', async () => {
    seedLiveShop()
    const provider = createTablesProvider()
    expect((await collect(provider, makeQuery('', { context: activeContext }))).map((r) => r.title).sort()).toEqual([
      'customers',
      'order_items',
      'orders'
    ])
    expect(await collect(provider, makeQuery(''))).toEqual([])
  })

  it('sends open-table intents and copies the name', async () => {
    seedLiveShop()
    const provider = createTablesProvider()
    const [result] = await collect(provider, makeQuery('customers'))
    const actions = provider.actions(result)
    actions.find((a) => a.role === 'primary')!.run()
    actions.find((a) => a.role === 'secondary')!.run()
    actions.find((a) => a.role === 'copy')!.run()
    expect(useSearchIntentStore.getState().pending.s1).toEqual([
      { kind: 'open-table', database: 'shop', table: 'customers', newTab: false },
      { kind: 'open-table', database: 'shop', table: 'customers', newTab: true }
    ])
    expect(writeText).toHaveBeenCalledWith('customers')
  })

  it('caps results at 50', async () => {
    seedLiveShop()
    useSQLStore.getState().setTables(
      't1',
      Array.from({ length: 90 }, (_, i) => ({ name: `log_${i}`, type: 'table' as const }))
    )
    expect(await collect(createTablesProvider(), makeQuery('log'))).toHaveLength(50)
  })
})
