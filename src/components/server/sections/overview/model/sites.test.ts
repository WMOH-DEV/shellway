import { describe, expect, it } from 'vitest'
import type { HostnameStatus, ServerBlock, SslReport, Verdict } from '@/types/ssl'
import { makeRecord, makeSummary } from '@/utils/deploy/testSummary'
import { deployDot, hostnamesForSite, httpsDot, siteRows } from './sites'

const NOW = 1_800_000_000
const DAY = 86400

const block = (id: string, root: string | null): ServerBlock => ({ id, file: '/etc/nginx/sites-enabled/x', line: 1, names: [], tls: true, certPath: '', keyPath: '', probeAddress: '', root })

const host = (name: string, blockId: string, verdict: Verdict, origin: Partial<NonNullable<HostnameStatus['origin']>> | null = null): HostnameStatus => ({
  name,
  blockId,
  wildcard: false,
  origin: origin ? { kind: 'letsencrypt', subject: name, issuer: 'R11', names: [name], notBefore: null, notAfter: null, error: null, ...origin } : null,
  lineage: null,
  edge: { state: 'not-on-cloudflare', zone: null, recordType: null, recordContent: null, sslMode: null, unknownReason: null },
  verdict,
  reason: '',
  uncheckedSide: null
})

const report = (blocks: ServerBlock[], hostnames: HostnameStatus[]): SslReport => ({ checkedAt: NOW, facts: {} as SslReport['facts'], blocks, lineages: [], hostnames, cloudflare: { saved: false, tokenHint: '', error: null, permissions: [], zones: [] } })

describe('deployDot', () => {
  it.each([
    ['live', makeSummary(), 'live', 'success'],
    ['failed', makeSummary({ history: [makeRecord({ status: 'failed' })] }), 'failed', 'error'],
    ['behind', makeSummary({ state: { remoteHead: 'bbb', behind: 2 } }), '2 behind', 'info'],
    ['deploying', makeSummary({ state: { busy: true } }), 'deploying', 'info'],
    ['never', makeSummary({ state: { current: '', remoteHead: '' } }), 'not deployed', 'neutral']
  ])('%s', (_name, summary, label, tone) => {
    expect(deployDot(summary)).toEqual({ label, tone })
  })
})

describe('httpsDot', () => {
  const site = makeSummary({ config: { name: 'shop', path: '/var/www/shop' } }).config

  it('matches hostnames by web root inside the site folder', () => {
    const ssl = report([block('b1', '/var/www/shop/current/public'), block('b2', '/var/www/shopping')], [host('shop.example.com', 'b1', 'ok'), host('other.example.com', 'b2', 'ok')])
    expect(hostnamesForSite(site, ssl).map((h) => h.name)).toEqual(['shop.example.com'])
  })

  it('also matches a hostname equal to the site name', () => {
    const named = makeSummary({ config: { name: 'app.example.com', path: '/srv/app' } }).config
    expect(hostnamesForSite(named, report([], [host('app.example.com', 'b9', 'ok')]))).toHaveLength(1)
  })

  it.each<[string, HostnameStatus[], string, string]>([
    ['days left', [host('a', 'b1', 'ok', { notAfter: NOW + 71 * DAY })], '71 d', 'success'],
    ['expiring', [host('a', 'b1', 'expiring', { notAfter: NOW + 12 * DAY })], '12 d', 'warning'],
    ['origin CA', [host('a', 'b1', 'ok', { kind: 'cloudflare-origin', notAfter: NOW + 4000 * DAY })], 'Origin CA', 'success'],
    ['worst host wins', [host('a', 'b1', 'ok'), host('b', 'b1', 'broken')], 'broken', 'error'],
    ['not encrypted', [host('a', 'b1', 'not-encrypted')], 'not encrypted', 'warning']
  ])('%s', (_name, hosts, label, tone) => {
    expect(httpsDot(site, report([block('b1', '/var/www/shop/current')], hosts), NOW)).toEqual({ label, tone })
  })

  it('shows a neutral dot without a report or a matching hostname', () => {
    expect(httpsDot(site, null, NOW)).toEqual({ label: '—', tone: 'neutral' })
    expect(httpsDot(site, report([], []), NOW)).toEqual({ label: 'no domain', tone: 'neutral' })
  })
})

describe('siteRows', () => {
  it('builds one row per site', () => {
    const rows = siteRows([makeSummary({ config: { name: 'shop', path: '/var/www/shop' } })], {}, null, NOW)
    expect(rows).toEqual([{ name: 'shop', path: '/var/www/shop', deploy: { label: 'live', tone: 'success' }, https: { label: '—', tone: 'neutral' } }])
  })
})
