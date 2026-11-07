import { describe, it, expect } from 'vitest'
import type { CloudflareStatus, EdgeInfo, OriginCert, ServerBlock, ServerScan } from '../../../src/types/ssl'
import { buildReport, isPattern, unknownEdges } from './report'

const DAY = 86_400
const NOW = 1_800_000_000

const block = (overrides: Partial<ServerBlock>): ServerBlock => ({
  id: 'app.conf:1', file: '/etc/nginx/sites-enabled/app.conf', line: 1, names: ['app.example.com'], tls: true,
  certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem', keyPath: '/etc/letsencrypt/live/app.example.com/privkey.pem', root: null,
  probeAddress: '127.0.0.1:443', ...overrides
})

const cert = (names: string[], days: number, kind: OriginCert['kind'] = 'letsencrypt'): OriginCert => ({
  kind, subject: `CN=${names[0]}`, issuer: 'CN=R11', names, notBefore: NOW - DAY, notAfter: NOW + days * DAY, error: null
})

const scan = (overrides: Partial<ServerScan> = {}): ServerScan => ({
  facts: {
    nginx: '1.24.0', openssl: '3.0.13', certbot: '2.11.0', otherWebServer: null, apache: null, serving: 'nginx', nginxParse: 'full',
    renewal: { mechanism: 'certbot.timer', lastRun: NOW - DAY, lastResult: 'success', output: '' },
    sudo: { certbot: true, nginx: true, apache: false, full: false }, paths: { certbot: '/usr/bin/certbot', nginx: '/usr/sbin/nginx', apache: null }, user: 'deploy', addresses: ['203.0.113.10']
  },
  blocks: [
    block({ id: 'app.conf:1', line: 1, names: ['app.example.com', 'www.example.com'], tls: false, certPath: '', keyPath: '' }),
    block({ id: 'app.conf:9', line: 9, names: ['app.example.com', 'www.example.com'] }),
    block({ id: 'api.conf:1', file: '/etc/nginx/sites-enabled/api.conf', names: ['api.example.com', '*.example.com', '_'], certPath: '/etc/ssl/other.pem' }),
    block({ id: 'plain.conf:1', file: '/etc/nginx/sites-enabled/plain.conf', names: ['plain.example.com'], tls: false, certPath: '', keyPath: '' })
  ],
  lineages: [{ name: 'app.example.com', domains: ['app.example.com', 'www.example.com'], notAfter: NOW + 5 * DAY, certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem', keyPath: '' }],
  origins: {
    'app.example.com': cert(['app.example.com', 'www.example.com'], 5),
    'www.example.com': cert(['app.example.com', 'www.example.com'], 5),
    'api.example.com': cert(['api.example.com'], 300, 'other'),
    'plain.example.com': cert(['app.example.com'], 5)
  },
  ...overrides
})

const cloudflare: CloudflareStatus = { saved: false, tokenHint: '', error: null, permissions: [], zones: [] }

const proxied: EdgeInfo = { state: 'proxied', zone: 'example.com', recordType: 'A', recordContent: '203.0.113.10', sslMode: 'strict', unknownReason: null }

describe('buildReport', () => {
  it('lists each name once, from the HTTPS block when a name has both', () => {
    const report = buildReport(scan(), unknownEdges(['x'], 'no token'), cloudflare, NOW)
    const names = report.hostnames.map((h) => h.name).sort()
    expect(names).toEqual(['*.example.com', 'api.example.com', 'app.example.com', 'plain.example.com', 'www.example.com'])
    expect(report.hostnames.find((h) => h.name === 'app.example.com')?.blockId).toBe('app.conf:9')
  })

  it('links the certbot lineage by certificate path and judges renewal from the server facts', () => {
    const edges = { 'app.example.com': proxied, 'www.example.com': proxied }
    const app = buildReport(scan(), edges, cloudflare, NOW).hostnames.find((h) => h.name === 'app.example.com')
    expect(app).toMatchObject({ lineage: 'app.example.com', verdict: 'expiring' })
    const failing = scan({ facts: { ...scan().facts, renewal: { mechanism: 'certbot.timer', lastRun: NOW, lastResult: 'failed', output: '' } } })
    expect(buildReport(failing, edges, cloudflare, NOW).hostnames.find((h) => h.name === 'app.example.com')?.verdict).toBe('will-break')
  })

  it('treats wildcard, regex and leading-dot server names as patterns', () => {
    expect(['*.example.com', '~^www\\.', '.example.com'].every(isPattern)).toBe(true)
    expect(isPattern('app.example.com')).toBe(false)
  })

  it('does not probe wildcard names and treats a plain HTTP block as having no certificate', () => {
    const report = buildReport(scan(), unknownEdges(['x'], 'no token'), cloudflare, NOW)
    expect(report.hostnames.find((h) => h.name === '*.example.com')).toMatchObject({ wildcard: true, origin: null, reason: 'Wildcard name, not checked' })
    expect(report.hostnames.find((h) => h.name === 'plain.example.com')).toMatchObject({ origin: { kind: 'none' }, verdict: 'not-encrypted' })
  })

  it('marks the Cloudflare side unknown for names without an edge entry', () => {
    const api = buildReport(scan(), {}, cloudflare, NOW).hostnames.find((h) => h.name === 'api.example.com')
    expect(api).toMatchObject({ verdict: 'unchecked', reason: 'Cloudflare side: no Cloudflare token', uncheckedSide: 'cloudflare' })
  })

  it('sorts by verdict severity, then days left', () => {
    const report = buildReport(scan(), { 'app.example.com': proxied, 'www.example.com': proxied, 'api.example.com': proxied }, cloudflare, NOW)
    expect(report.hostnames.map((h) => h.verdict)).toEqual(['expiring', 'expiring', 'not-encrypted', 'unchecked', 'ok'])
    expect(report.checkedAt).toBe(NOW)
  })
})
