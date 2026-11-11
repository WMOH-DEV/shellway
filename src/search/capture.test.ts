import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@/stores/connectionStore'
import { useServerFactsStore } from '@/stores/serverFactsStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSQLStore } from '@/stores/sqlStore'
import type { SchemaColumn } from '@/types/sql'
import { captureListing, startSearchCapture } from './capture'
import { useSearchCacheStore } from './cacheClient'
import { makeSession, makeTab, resetSearchState, stubBrowser } from './providers/testHelpers'

const column = (name: string, tableName: string): SchemaColumn => ({
  name,
  tableName,
  type: 'int',
  nullable: false,
  defaultValue: null,
  isPrimaryKey: false,
  isAutoIncrement: false
})

describe('search capture', () => {
  const cacheApply = vi.fn()
  let stop: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    cacheApply.mockReset().mockResolvedValue(undefined)
    stubBrowser({ search: { cacheApply } })
    resetSearchState()
    useSessionStore.setState({ sessions: [makeSession()] })
    useConnectionStore.setState({ tabs: [makeTab()], activeTabId: 't1' })
    stop = startSearchCapture()
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function loadSchema(tables: string[], columns: SchemaColumn[] = []): void {
    const sql = useSQLStore.getState()
    sql.setCurrentDatabase('t1', 'shop')
    sql.setTables(
      't1',
      tables.map((name) => ({ name, type: 'table' as const }))
    )
    sql.setColumns('t1', columns)
  }

  it('is idempotent', () => {
    expect(startSearchCapture()).toBe(stop)
  })

  it('debounces table capture by 500 ms and sends one patch with columns', async () => {
    loadSchema(['orders'], [column('status', 'orders')])
    await vi.advanceTimersByTimeAsync(499)
    expect(cacheApply).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(cacheApply).toHaveBeenCalledTimes(1)
    expect(cacheApply).toHaveBeenCalledWith({
      kind: 'tables',
      scopeId: 's1',
      database: 'shop',
      tables: [{ name: 'orders', type: 'table', columns: ['status'] }]
    })
  })

  it('keys the cache by the saved session id, not the tab id', async () => {
    loadSchema(['orders'])
    await vi.advanceTimersByTimeAsync(500)
    expect(Object.keys(useSearchCacheStore.getState().snapshot!.tables)).toEqual(['s1'])
  })

  it('replaces the table list so a renamed table drops the old name', async () => {
    loadSchema(['orders'])
    await vi.advanceTimersByTimeAsync(500)
    loadSchema(['sales'])
    await vi.advanceTimersByTimeAsync(500)
    const names = useSearchCacheStore.getState().snapshot!.tables.s1.shop.map((t) => t.name)
    expect(names).toEqual(['sales'])
  })

  it('does not resend an identical schema', async () => {
    loadSchema(['orders'])
    await vi.advanceTimersByTimeAsync(500)
    loadSchema(['orders'])
    await vi.advanceTimersByTimeAsync(500)
    expect(cacheApply).toHaveBeenCalledTimes(1)
  })

  it('ignores connections without a database or tables', async () => {
    useSQLStore.getState().setTables('t1', [])
    await vi.advanceTimersByTimeAsync(500)
    expect(cacheApply).not.toHaveBeenCalled()
  })

  it('captures sites and services from server facts', async () => {
    useServerFactsStore.setState({
      byConnection: {
        t1: {
          'sites.inventory': {
            status: 'ok',
            at: 1,
            data: { user: 'deploy', fpmVersions: [], sites: [{ name: 'shop.example.com', owner: 'deploy', path: '/var/www/shop' }], vhosts: [] }
          },
          'services.containers': {
            status: 'ok',
            at: 1,
            data: {
              installed: true,
              access: null,
              containers: [{ id: 'c1', name: 'redis-cache', image: 'redis', state: 'running', status: 'Up 1 hour', project: '', restartPolicy: 'no', cpuPercent: null, memoryBytes: null }]
            }
          }
        }
      }
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(cacheApply).toHaveBeenCalledWith({
      kind: 'server',
      scopeId: 's1',
      sites: [{ name: 'shop.example.com', root: '/var/www/shop' }],
      services: [{ id: 'container:redis-cache', name: 'redis-cache', kind: 'container' }]
    })
  })

  it('forgets a deleted session', async () => {
    loadSchema(['orders'])
    await vi.advanceTimersByTimeAsync(500)
    useSessionStore.getState().removeSession('s1')
    expect(cacheApply).toHaveBeenLastCalledWith({ kind: 'forget', scopeId: 's1' })
    expect(useSearchCacheStore.getState().snapshot!.tables.s1).toBeUndefined()
  })

  it('stops watching after the returned stop function runs', async () => {
    stop()
    loadSchema(['orders'])
    await vi.advanceTimersByTimeAsync(600)
    expect(cacheApply).not.toHaveBeenCalled()
    stop = startSearchCapture()
  })

  describe('captureListing', () => {
    it('stores the folder and its entries with a trailing slash on directories', () => {
      captureListing('s1', '/var/www/shop', [
        { path: '/var/www/shop/app', isDirectory: true },
        { path: '/var/www/shop/index.php', isDirectory: false }
      ])
      expect(cacheApply).toHaveBeenCalledWith({
        kind: 'paths',
        scopeId: 's1',
        paths: ['/var/www/shop/', '/var/www/shop/app/', '/var/www/shop/index.php']
      })
    })

    it('caps a listing at 500 paths', () => {
      const entries = Array.from({ length: 800 }, (_, i) => ({ path: `/srv/f${i}`, isDirectory: false }))
      captureListing('s1', '/srv', entries)
      expect(cacheApply.mock.calls[0][0].paths).toHaveLength(500)
    })
  })
})
