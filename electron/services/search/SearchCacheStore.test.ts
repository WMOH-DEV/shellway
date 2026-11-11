import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchCachePatch } from '../../../src/types/search'
import { SearchCacheStore } from './SearchCacheStore'

const tablesPatch: SearchCachePatch = {
  kind: 'tables',
  scopeId: 'session-1',
  database: 'shop',
  tables: [{ name: 'orders', type: 'table', columns: ['id', 'total'] }]
}

const newFile = () => join(mkdtempSync(join(tmpdir(), 'shellway-search-cache-')), 'search-cache.json')

describe('SearchCacheStore', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts empty when there is no file', () => {
    const store = new SearchCacheStore(newFile())
    expect(store.get().tables).toEqual({})
    expect(store.stats()).toEqual({ entries: 0, bytes: expect.any(Number) })
  })

  it('applies a patch to the snapshot and counts the entries', () => {
    const store = new SearchCacheStore(newFile())
    store.apply(tablesPatch)
    expect(store.get().tables['session-1'].shop[0].name).toBe('orders')
    expect(store.stats().entries).toBe(1)
  })

  it('writes to disk after the debounce and a new store reads it back', () => {
    const file = newFile()
    const store = new SearchCacheStore(file, () => 1000, 1000)
    store.apply(tablesPatch)
    expect(existsSync(file)).toBe(false)

    vi.advanceTimersByTime(999)
    expect(existsSync(file)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(existsSync(file)).toBe(true)

    expect(new SearchCacheStore(file).get().tables['session-1'].shop[0].columns).toEqual(['id', 'total'])
  })

  it('writes once for a burst of patches', () => {
    const file = newFile()
    const store = new SearchCacheStore(file)
    store.apply(tablesPatch)
    store.apply({ kind: 'paths', scopeId: 'session-1', paths: ['/var/www/shop/'] })
    vi.advanceTimersByTime(1000)
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved.tables['session-1']).toBeDefined()
    expect(saved.paths['session-1']).toEqual(['/var/www/shop/'])
  })

  it('flush writes immediately and stops the pending timer', () => {
    const file = newFile()
    const store = new SearchCacheStore(file)
    store.apply(tablesPatch)
    store.flush()
    expect(existsSync(file)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('flush does nothing when nothing changed', () => {
    const file = newFile()
    new SearchCacheStore(file).flush()
    expect(existsSync(file)).toBe(false)
  })

  it('ignores patches the rules reject without scheduling a write', () => {
    const store = new SearchCacheStore(newFile())
    store.apply({ kind: 'paths', scopeId: '', paths: ['/a'] })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clear empties the snapshot and the file immediately', () => {
    const file = newFile()
    const store = new SearchCacheStore(file)
    store.apply(tablesPatch)
    store.flush()
    store.clear()
    expect(store.get().tables).toEqual({})
    expect(JSON.parse(readFileSync(file, 'utf8')).tables).toEqual({})
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clear drops a write that was still pending', () => {
    const file = newFile()
    const store = new SearchCacheStore(file)
    store.apply(tablesPatch)
    store.clear()
    vi.advanceTimersByTime(5000)
    expect(JSON.parse(readFileSync(file, 'utf8')).tables).toEqual({})
  })

  it('treats a corrupt file as empty', () => {
    const file = newFile()
    writeFileSync(file, '{not json')
    expect(new SearchCacheStore(file).get().tables).toEqual({})
  })

  it('treats a file from another version as empty', () => {
    const file = newFile()
    writeFileSync(file, JSON.stringify({ version: 999, tables: { s: { d: [{ name: 't', type: 'table', columns: [] }] } } }))
    expect(new SearchCacheStore(file).get().tables).toEqual({})
  })

  it('stamps server entries with the injected clock', () => {
    const store = new SearchCacheStore(newFile(), () => 4242)
    store.apply({ kind: 'server', scopeId: 's1', sites: [{ name: 'shop.example.com', root: '/var/www/shop' }], services: [] })
    expect(store.get().servers.s1.updatedAt).toBe(4242)
  })
})
