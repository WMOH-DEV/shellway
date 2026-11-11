import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSearchIntentStore } from '../intentStore'
import { createHistoryProvider } from './history'
import { createQueriesProvider } from './queries'
import { collect, EMPTY_CONTEXT, makeQuery, makeSession, makeTab, resetSearchState, stubBrowser } from './testHelpers'

const NOW = new Date('2026-01-10T12:00:00Z').getTime()

describe('queries and history providers', () => {
  const queriesList = vi.fn()
  const historyList = vi.fn()
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    queriesList.mockReset().mockResolvedValue([
      { id: 'q1', name: 'Revenue by month', sql: 'SELECT 1', groupId: null, createdAt: 1, updatedAt: 1 },
      { id: 'q2', name: 'Stale carts', sql: 'SELECT 2', groupId: null, createdAt: 1, updatedAt: 1 }
    ])
    historyList.mockReset().mockResolvedValue({
      entries: [
        { id: 'h1', query: 'SELECT *\n  FROM orders\n WHERE id = 5', database: 'shop', source: 'user', executedAt: NOW - 3_600_000 * 2, executionTimeMs: 3, rowCount: 1, isFavorite: false },
        { id: 'h2', query: "CREATE USER 'bob' IDENTIFIED BY 'secret'", database: 'shop', source: 'user', executedAt: NOW - 1000, executionTimeMs: 3, isFavorite: false },
        { id: 'h3', query: 'SELECT COUNT(*) FROM customers', database: 'shop', source: 'user', executedAt: NOW - 60_000, executionTimeMs: 3, rowCount: 1, isFavorite: false }
      ],
      total: 3
    })
    writeText = stubBrowser({ sql: { queriesList, historyList } }).writeText
    resetSearchState()
    useSessionStore.setState({ sessions: [makeSession()] })
    useConnectionStore.setState({ tabs: [makeTab()], activeTabId: 't1' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('queries', () => {
    it('matches by name and opens the query in an SQL tab', async () => {
      const provider = createQueriesProvider()
      const results = await collect(provider, makeQuery('revenue'))
      expect(results.map((r) => r.id)).toEqual(['query:s1:q1'])
      provider.actions(results[0]).find((a) => a.role === 'primary')!.run()
      expect(useSearchIntentStore.getState().pending.s1).toEqual([{ kind: 'open-sql', sql: 'SELECT 1', title: 'Revenue by month' }])
    })

    it('does not match on the SQL text', async () => {
      expect(await collect(createQueriesProvider(), makeQuery('select'))).toEqual([])
    })

    it('caches the list for 30 seconds per scope', async () => {
      const provider = createQueriesProvider()
      await collect(provider, makeQuery('revenue'))
      await collect(provider, makeQuery('stale'))
      expect(queriesList).toHaveBeenCalledTimes(1)
      vi.setSystemTime(NOW + 31_000)
      await collect(provider, makeQuery('stale'))
      expect(queriesList).toHaveBeenCalledTimes(2)
    })

    it('copies the SQL and returns nothing on an empty query', async () => {
      const provider = createQueriesProvider()
      const [result] = await collect(provider, makeQuery('stale'))
      provider.actions(result).find((a) => a.role === 'copy')!.run()
      expect(writeText).toHaveBeenCalledWith('SELECT 2')
      expect(await collect(provider, makeQuery(''))).toEqual([])
    })

    it('survives a failing list call', async () => {
      queriesList.mockRejectedValue(new Error('boom'))
      expect(await collect(createQueriesProvider(), makeQuery('revenue'))).toEqual([])
    })
  })

  describe('history', () => {
    it('requests user history and collapses the title to one line', async () => {
      const provider = createHistoryProvider()
      const results = await collect(provider, makeQuery('orders'))
      expect(historyList).toHaveBeenCalledWith('s1', { limit: 200, source: 'user' })
      expect(results[0].title).toBe('SELECT * FROM orders WHERE id = 5')
      expect(results[0].subtitle).toBe('ran 2h ago · 1 rows · shop')
    })

    it('skips credential statements', async () => {
      const provider = createHistoryProvider()
      expect(await collect(provider, makeQuery('secret'))).toEqual([])
      expect(await collect(provider, makeQuery('create user'))).toEqual([])
    })

    it('truncates long titles to 120 characters', async () => {
      historyList.mockResolvedValue({
        entries: [{ id: 'h9', query: `SELECT ${'a'.repeat(300)}`, database: '', source: 'user', executedAt: NOW, executionTimeMs: 1, isFavorite: false }],
        total: 1
      })
      const [result] = await collect(createHistoryProvider(), makeQuery('select'))
      expect(result.title).toHaveLength(120)
    })

    it('suggests the newest entries of the active session on an empty query', async () => {
      const context = { ...EMPTY_CONTEXT, activeSessionId: 's1' }
      const results = await collect(createHistoryProvider(), makeQuery('', { context }))
      expect(results.map((r) => r.id)).toEqual(['history:s1:h3', 'history:s1:h1'])
      expect(await collect(createHistoryProvider(), makeQuery(''))).toEqual([])
    })

    it('opens a new query tab and copies the SQL', async () => {
      const provider = createHistoryProvider()
      const [result] = await collect(provider, makeQuery('customers'))
      const actions = provider.actions(result)
      actions.find((a) => a.role === 'primary')!.run()
      actions.find((a) => a.role === 'copy')!.run()
      expect(useSearchIntentStore.getState().pending.s1[0]).toMatchObject({ kind: 'open-sql', sql: 'SELECT COUNT(*) FROM customers', database: 'shop' })
      expect(writeText).toHaveBeenCalledWith('SELECT COUNT(*) FROM customers')
    })
  })
})
