import { describe, expect, it } from 'vitest'
import type { AttentionItem } from '@/types/server/core'
import { countsByArea, mergeSitesAttention, rankAttention, SSL_CRITICAL_ID, withSslCritical, worstLevel } from './useServerAttention'

const item = (overrides: Partial<AttentionItem>): AttentionItem => ({
  id: 'x',
  area: 'overview',
  level: 'info',
  rank: 10,
  title: 'Title',
  detail: 'Detail',
  actionLabel: 'Fix',
  route: { section: 'overview' },
  ...overrides
})

describe('worstLevel', () => {
  it.each([
    [[], null],
    [[item({ level: 'info' })], 'info'],
    [[item({ level: 'info' }), item({ level: 'warning' })], 'warning'],
    [[item({ level: 'warning' }), item({ level: 'error' }), item({ level: 'info' })], 'error']
  ] as const)('picks the most serious level', (items, expected) => {
    expect(worstLevel(items)).toBe(expected)
  })
})

describe('countsByArea', () => {
  it('counts items per section and skips empty ones', () => {
    const items = [item({ area: 'services' }), item({ area: 'services' }), item({ area: 'sites' })]
    expect(countsByArea(items)).toEqual({ services: 2, sites: 1 })
  })
})

describe('rankAttention', () => {
  it('puts the highest rank first without touching the input', () => {
    const items = [item({ id: 'a', rank: 20 }), item({ id: 'b', rank: 150 }), item({ id: 'c', rank: 60 })]
    expect(rankAttention(items).map((i) => i.id)).toEqual(['b', 'c', 'a'])
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('withSslCritical', () => {
  it('adds one error item for Sites when a certificate is critical', () => {
    const result = withSslCritical([item({ id: 'a' })], true)
    expect(result).toHaveLength(2)
    expect(result[1]).toMatchObject({ id: SSL_CRITICAL_ID, area: 'sites', level: 'error', route: { section: 'sites', sub: 'https' } })
  })

  it('does not add a second item when Sites already reports it', () => {
    const existing = item({ id: SSL_CRITICAL_ID, area: 'sites', level: 'error' })
    expect(withSslCritical([existing], true)).toEqual([existing])
  })

  it('adds nothing when no certificate is critical', () => {
    expect(withSslCritical([], false)).toEqual([])
  })
})

describe('mergeSitesAttention', () => {
  it('replaces the generic certificate item with per-site items and ranks everything', () => {
    const generic = item({ id: SSL_CRITICAL_ID, area: 'sites', rank: 170 })
    const disk = item({ id: 'overview.disk', area: 'overview', rank: 180 })
    const cert = item({ id: 'sites.cert.app.example.com', area: 'sites', rank: 170 })
    const deploy = item({ id: 'sites.deploy.shop', area: 'sites', rank: 160 })
    expect(mergeSitesAttention([generic, disk], [deploy, cert]).map((entry) => entry.id)).toEqual(['overview.disk', 'sites.cert.app.example.com', 'sites.deploy.shop'])
  })

  it('keeps the generic certificate item when sites report none', () => {
    const generic = item({ id: SSL_CRITICAL_ID, area: 'sites', rank: 170 })
    expect(mergeSitesAttention([generic], [item({ id: 'sites.deploy.shop', area: 'sites', rank: 160 })]).map((entry) => entry.id)).toEqual([SSL_CRITICAL_ID, 'sites.deploy.shop'])
  })
})
