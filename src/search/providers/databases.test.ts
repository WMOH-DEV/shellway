import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSavedDatabaseStore } from '@/stores/savedDatabaseStore'
import { useUIStore } from '@/stores/uiStore'
import type { SavedDatabase } from '@/types/sql'
import { sendIntent, useSearchIntentStore } from '../intentStore'
import { createDatabasesProvider } from './databases'
import { createTablesProvider } from './tables'
import { useSearchCacheStore } from '../cacheClient'
import { emptySnapshot } from '../cachePatch'
import { collect, makeQuery, makeTab, resetSearchState, stubBrowser } from './testHelpers'

function makeDatabase(overrides: Partial<SavedDatabase> = {}): SavedDatabase {
  return { sessionId: 'db-1', connectionName: 'Billing', type: 'mysql', host: 'db.example.com', port: 3306, database: 'billing', ...overrides }
}

function pendingKinds(sessionId: string): string[] {
  return (useSearchIntentStore.getState().pending[sessionId] ?? []).map((intent) => intent.kind)
}

describe('databases provider', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = stubBrowser().writeText
    resetSearchState()
    useSavedDatabaseStore.setState({
      databases: [
        makeDatabase({ tag: 'production', lastUsed: Date.now() - 1000 }),
        makeDatabase({ sessionId: 'db-2', connectionName: undefined, type: 'postgres', host: 'pg.example.com', port: 5432, database: 'analytics', lastUsed: Date.now() - 9_000_000 }),
        makeDatabase({ sessionId: 'db-3', connectionName: 'Legacy', host: 'old.example.com', database: '', tag: 'none' })
      ]
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  const ids = async (text: string) => (await collect(createDatabasesProvider(), makeQuery(text))).map((r) => r.id)

  it('matches name, host, database, engine and tag', async () => {
    expect(await ids('billing')).toEqual(['database:db-1'])
    expect(await ids('pg.example')).toEqual(['database:db-2'])
    expect(await ids('analytics')).toEqual(['database:db-2'])
    expect(await ids('postgresql')).toEqual(['database:db-2'])
    expect(await ids('production')).toEqual(['database:db-1'])
    expect(await ids('legacy')).toEqual(['database:db-3'])
  })

  it('names unnamed connections and describes where they point', async () => {
    const results = await collect(createDatabasesProvider(), makeQuery('example'))
    const byId = Object.fromEntries(results.map((r) => [r.id, r]))
    expect(byId['database:db-1']).toMatchObject({ title: 'Billing', subtitle: 'MySQL · db.example.com:3306 · billing · production', icon: 'database' })
    expect(byId['database:db-2']).toMatchObject({ title: 'POSTGRES · analytics', subtitle: 'PostgreSQL · pg.example.com:5432 · analytics' })
    expect(byId['database:db-3'].subtitle).toBe('MySQL · old.example.com:3306')
  })

  it('suggests recently used connections on an empty query', async () => {
    expect(await ids('')).toEqual(['database:db-1', 'database:db-2'])
  })

  it('shows whether a tab is already open', async () => {
    useConnectionStore.setState({ tabs: [makeTab({ id: 't1', sessionId: 'db-1', type: 'database' }), makeTab({ id: 't2', sessionId: 'db-2', type: 'database', status: 'disconnected' })] })
    const results = await collect(createDatabasesProvider(), makeQuery('example'))
    const hints = Object.fromEntries(results.map((r) => [r.id, r.hint]))
    expect(hints).toEqual({ 'database:db-1': 'connected', 'database:db-2': 'tab open', 'database:db-3': undefined })
  })

  it('opens a closed connection and asks it to connect', async () => {
    const provider = createDatabasesProvider()
    const [result] = await collect(provider, makeQuery('billing'))
    provider.actions(result).find((a) => a.role === 'primary')!.run()
    expect(useUIStore.getState().openDatabaseRequest).toEqual({ sessionId: 'db-1', name: 'Billing' })
    expect(pendingKinds('db-1')).toEqual(['sql-connect'])
  })

  it('only focuses a connection that is already connected', async () => {
    useConnectionStore.setState({ tabs: [makeTab({ id: 't1', sessionId: 'db-1', type: 'database' })] })
    const provider = createDatabasesProvider()
    const [result] = await collect(provider, makeQuery('billing'))
    provider.actions(result).find((a) => a.role === 'primary')!.run()
    expect(useUIStore.getState().openDatabaseRequest).toEqual({ sessionId: 'db-1', name: 'Billing' })
    expect(pendingKinds('db-1')).toEqual([])
  })

  it('copies the host', async () => {
    const provider = createDatabasesProvider()
    const [result] = await collect(provider, makeQuery('billing'))
    provider.actions(result).find((a) => a.role === 'copy')!.run()
    expect(writeText).toHaveBeenCalledWith('db.example.com')
  })
})

describe('tables of a saved database', () => {
  beforeEach(() => {
    stubBrowser()
    resetSearchState()
    useSavedDatabaseStore.setState({ databases: [makeDatabase()] })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('names the connection instead of "Server"', async () => {
    useSearchCacheStore.setState({
      snapshot: { ...emptySnapshot(), tables: { 'db-1': { billing: [{ name: 'invoices', type: 'table', columns: [] }] } } }
    })
    const [result] = await collect(createTablesProvider(), makeQuery('invoices'))
    expect(result.subtitle).toBe('table · billing · Billing')
  })

  it('opens and connects a closed connection before opening the table', () => {
    sendIntent('db-1', { kind: 'open-table', database: 'billing', table: 'invoices', newTab: false })
    expect(useUIStore.getState().openDatabaseRequest).toEqual({ sessionId: 'db-1', name: 'Billing' })
    expect(pendingKinds('db-1')).toEqual(['sql-connect', 'open-table'])
  })
})
