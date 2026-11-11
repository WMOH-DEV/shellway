import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@/stores/connectionStore'
import { useServerFactsStore } from '@/stores/serverFactsStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSnippetStore } from '@/stores/snippetStore'
import { useSQLStore } from '@/stores/sqlStore'
import type { ServerFacts } from '@/types/server/core'
import { startSearchCapture } from '../capture'
import { useSearchCacheStore } from '../cacheClient'
import { createProviders } from './index'
import { collect, makeQuery, makeSession, makeTab, resetSearchState, stubBrowser } from './testHelpers'

const SECRET = 'hunter2'

const FACTS: ServerFacts = {
  'sites.inventory': {
    status: 'ok',
    at: 1,
    data: {
      user: 'deploy',
      fpmVersions: [],
      sites: [{ name: 'shop.example.com', owner: 'deploy', path: '/var/www/shop' }],
      vhosts: [
        {
          sha256: 'b'.repeat(64),
          path: '/etc/nginx/sites-enabled/shop',
          realPath: '/etc/nginx/sites-enabled/shop',
          content: `server { server_name shop.example.com; auth_basic_user_file /etc/nginx/${SECRET}; set $token ${SECRET}; }`
        }
      ]
    }
  }
}

describe('privacy', () => {
  const cacheApply = vi.fn()
  const queriesList = vi.fn()
  const historyList = vi.fn()
  let stop: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    cacheApply.mockReset().mockResolvedValue(undefined)
    queriesList.mockReset().mockResolvedValue([{ id: 'q1', name: 'Monthly revenue', sql: `SELECT '${SECRET}'`, groupId: null, createdAt: 1, updatedAt: 1 }])
    historyList.mockReset().mockResolvedValue({
      entries: [
        { id: 'h1', query: `CREATE USER x IDENTIFIED BY '${SECRET}'`, database: 'shop', source: 'user', executedAt: 1, executionTimeMs: 1, isFavorite: false },
        { id: 'h2', query: `SET PASSWORD = '${SECRET}'`, database: 'shop', source: 'user', executedAt: 1, executionTimeMs: 1, isFavorite: false },
        { id: 'h4', query: `ALTER USER app WITH PASSWORD '${SECRET}'`, database: 'shop', source: 'user', executedAt: 1, executionTimeMs: 1, isFavorite: false },
        { id: 'h5', query: `CREATE ROLE app LOGIN PASSWORD '${SECRET}'`, database: 'shop', source: 'user', executedAt: 1, executionTimeMs: 1, isFavorite: false },
        { id: 'h6', query: `CREATE SERVER s OPTIONS (user 'a', password '${SECRET}')`, database: 'shop', source: 'user', executedAt: 1, executionTimeMs: 1, isFavorite: false },
        { id: 'h3', query: 'SELECT * FROM orders', database: 'shop', source: 'user', executedAt: 1, executionTimeMs: 1, isFavorite: false }
      ],
      total: 6
    })
    stubBrowser({ sql: { queriesList, historyList }, search: { cacheApply, findFiles: vi.fn(), cancel: vi.fn(), onEvent: vi.fn() } })
    resetSearchState()
    stop = startSearchCapture()
    useSessionStore.setState({
      sessions: [
        {
          ...makeSession({
            id: 's1',
            auth: { initialMethod: 'password', password: SECRET, privateKeyData: `-----BEGIN KEY-----${SECRET}`, passphrase: SECRET },
            environmentVariables: { DB_PASSWORD: SECRET },
            notes: `root pw ${SECRET}`
          })
        }
      ]
    })
    useConnectionStore.setState({ tabs: [makeTab()], activeTabId: 't1' })
    useServerFactsStore.setState({ byConnection: { t1: FACTS } })
    useSnippetStore.setState({
      snippets: [{ id: 'sn1', name: 'Restart nginx', command: `mysql -p${SECRET}`, category: 'Web', createdAt: 1, updatedAt: 1 }]
    })
    const sql = useSQLStore.getState()
    sql.setCurrentDatabase('t1', 'shop')
    sql.setTables('t1', [{ name: 'orders', type: 'table' }])
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('finds nothing for a secret in any provider', async () => {
    for (const provider of createProviders()) {
      const pending = collect(provider, makeQuery(SECRET))
      await vi.advanceTimersByTimeAsync(300)
      expect(await pending, `${provider.id}:${provider.kind}`).toEqual([])
    }
  })

  it('still finds legitimate data from the same fixtures', async () => {
    const hits = await Promise.all(
      ['shop.example.com', 'orders', 'monthly', 'restart'].map(async (text) => {
        const local = createProviders().filter((p) => p.kind === 'local')
        const found = await Promise.all(local.map((p) => collect(p, makeQuery(text))))
        return found.flat().length
      })
    )
    expect(hits.every((count) => count > 0)).toBe(true)
  })

  it('never sends or stores a secret from capture', async () => {
    await vi.advanceTimersByTimeAsync(600)
    expect(cacheApply).toHaveBeenCalled()
    expect(JSON.stringify(cacheApply.mock.calls)).not.toContain(SECRET)
    expect(JSON.stringify(useSearchCacheStore.getState().snapshot)).not.toContain(SECRET)
  })
})
