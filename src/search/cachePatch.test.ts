import { describe, expect, it } from 'vitest'
import { CACHE_LIMITS, CACHE_VERSION, applyPatch, emptySnapshot, learnedKey, normalizeSnapshot, snapshotStats } from './cachePatch'
import type { SearchCachePatch } from '../types/search'

const NOW = 1_000_000

describe('applyPatch', () => {
  it('stores only whitelisted table fields', () => {
    const tables = [{ name: 'users', type: 'table', columns: ['id', 'email'], rows: [{ password: 'hunter2' }], password: 'x' }]
    const s = applyPatch(emptySnapshot(), { kind: 'tables', scopeId: 's1', database: 'shop', tables } as unknown as SearchCachePatch, NOW)
    expect(s.tables.s1.shop).toEqual([{ name: 'users', type: 'table', columns: ['id', 'email'] }])
    expect(JSON.stringify(s)).not.toMatch(/hunter2|password/)
  })

  it('keeps only name and root for sites, never vhost content or env values', () => {
    const sites = [{ name: 'shop.example.com', root: '/var/www/shop', content: 'DB_PASSWORD=secret', env: { APP_KEY: 'base64:abc' } }]
    const s = applyPatch(emptySnapshot(), { kind: 'server', scopeId: 's1', sites, services: [] } as unknown as SearchCachePatch, NOW)
    expect(s.servers.s1.sites).toEqual([{ name: 'shop.example.com', root: '/var/www/shop' }])
    expect(JSON.stringify(s)).not.toMatch(/secret|APP_KEY|base64/)
  })

  it('rejects names with control characters and relative paths', () => {
    let s = applyPatch(emptySnapshot(), { kind: 'tables', scopeId: 's1', database: 'db', tables: [{ name: 'a\nb', type: 'table', columns: [] }] }, NOW)
    expect(s.tables.s1.db).toEqual([])
    s = applyPatch(s, { kind: 'paths', scopeId: 's1', paths: ['relative/file.txt', '/abs/file.txt'] }, NOW)
    expect(s.paths.s1).toEqual(['/abs/file.txt'])
  })

  it('puts new paths first, dedupes, and caps per scope', () => {
    let s = applyPatch(emptySnapshot(), { kind: 'paths', scopeId: 's1', paths: ['/a', '/b'] }, NOW)
    s = applyPatch(s, { kind: 'paths', scopeId: 's1', paths: ['/c', '/a'] }, NOW)
    expect(s.paths.s1).toEqual(['/c', '/a', '/b'])
    const many = Array.from({ length: CACHE_LIMITS.pathsPerScope + 10 }, (_, i) => `/f${i}`)
    s = applyPatch(s, { kind: 'paths', scopeId: 's1', paths: many }, NOW)
    expect(s.paths.s1).toHaveLength(CACHE_LIMITS.pathsPerScope)
  })

  it('counts usage and learns query prefixes', () => {
    let s = applyPatch(emptySnapshot(), { kind: 'usage', resultId: 'table:s1:shop:orders', queryText: 'Ord' }, NOW)
    s = applyPatch(s, { kind: 'usage', resultId: 'table:s1:shop:orders', queryText: 'ord ' }, NOW + 5)
    expect(s.usage['table:s1:shop:orders']).toEqual({ count: 2, lastUsedAt: NOW + 5 })
    expect(s.learned[learnedKey('ord')]).toEqual({ 'table:s1:shop:orders': 2 })
  })

  it('evicts the least recently used entries beyond the cap', () => {
    let s = emptySnapshot()
    for (let i = 0; i <= CACHE_LIMITS.usage; i++) s = applyPatch(s, { kind: 'usage', resultId: `r${i}`, queryText: '' }, i)
    expect(Object.keys(s.usage)).toHaveLength(CACHE_LIMITS.usage)
    expect(s.usage.r0).toBeUndefined()
  })

  it('forgets a deleted session', () => {
    let s = applyPatch(emptySnapshot(), { kind: 'paths', scopeId: 's1', paths: ['/a'] }, NOW)
    s = applyPatch(s, { kind: 'tables', scopeId: 's1', database: 'db', tables: [{ name: 't', type: 'table', columns: [] }] }, NOW)
    s = applyPatch(s, { kind: 'usage', resultId: 'file:s1:/var/www/shop/.env.example', queryText: 'env' }, NOW)
    s = applyPatch(s, { kind: 'usage', resultId: 'session:s1', queryText: 'shop' }, NOW)
    s = applyPatch(s, { kind: 'usage', resultId: 'file:s2:/srv/app.php', queryText: 'app' }, NOW)
    s = applyPatch(s, { kind: 'forget', scopeId: 's1' }, NOW)
    expect(Object.keys(s.usage)).toEqual(['file:s2:/srv/app.php'])
    expect(JSON.stringify(s.learned)).not.toContain(':s1:')
    expect(s.paths.s1).toBeUndefined()
    expect(s.tables.s1).toBeUndefined()
  })

  it('forgets a deleted saved database', () => {
    let s = applyPatch(emptySnapshot(), { kind: 'usage', resultId: 'database:db-1', queryText: 'billing' }, NOW)
    s = applyPatch(s, { kind: 'usage', resultId: 'database:db-2', queryText: 'shop' }, NOW)
    s = applyPatch(s, { kind: 'forget', scopeId: 'db-1' }, NOW)
    expect(Object.keys(s.usage)).toEqual(['database:db-2'])
    expect(JSON.stringify(s.learned)).not.toContain('database:db-1')
  })

  it('replaces a database table list on refresh so renamed and dropped tables disappear', () => {
    let s = applyPatch(emptySnapshot(), { kind: 'tables', scopeId: 's1', database: 'db', tables: [{ name: 'old_name', type: 'table', columns: [] }] }, NOW)
    s = applyPatch(s, { kind: 'tables', scopeId: 's1', database: 'db', tables: [{ name: 'new_name', type: 'table', columns: [] }] }, NOW)
    expect(s.tables.s1.db.map((t) => t.name)).toEqual(['new_name'])
  })
})

describe('normalizeSnapshot', () => {
  it('resets on a version bump', () => {
    expect(normalizeSnapshot({ version: CACHE_VERSION + 1, paths: { s1: ['/a'] } })).toEqual(emptySnapshot())
  })

  it('re-sanitises a stored file', () => {
    const raw = { version: CACHE_VERSION, tables: { s1: { db: [{ name: 't', type: 'table', columns: [], secret: 'x' }] } }, paths: { s1: ['/a', 'rel'] } }
    const s = normalizeSnapshot(raw)
    expect(s.tables.s1.db).toEqual([{ name: 't', type: 'table', columns: [] }])
    expect(s.paths.s1).toEqual(['/a'])
  })

  it('survives garbage', () => {
    expect(normalizeSnapshot('nope')).toEqual(emptySnapshot())
    expect(normalizeSnapshot(null)).toEqual(emptySnapshot())
  })
})

describe('snapshotStats', () => {
  it('counts entries', () => {
    const s = applyPatch(emptySnapshot(), { kind: 'paths', scopeId: 's1', paths: ['/a', '/b'] }, NOW)
    expect(snapshotStats(s).entries).toBe(2)
    expect(snapshotStats(s).bytes).toBeGreaterThan(0)
  })
})
