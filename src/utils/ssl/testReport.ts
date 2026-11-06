import type { CloudflareStatus, EdgeInfo, HostnameStatus, OriginCert, ServerBlock, ServerFacts, SslReport } from '../../types/ssl'

export const DAY = 86_400
export const NOW = 1_800_000_000

export const proxiedEdge: EdgeInfo = { state: 'proxied', zone: 'example.com', recordType: 'A', recordContent: '203.0.113.10', sslMode: 'strict', unknownReason: null }

export const edgeOf = (overrides: Partial<EdgeInfo>): EdgeInfo => ({ ...proxiedEdge, ...overrides })

export const unknownEdge: EdgeInfo = { state: 'unknown', zone: null, recordType: null, recordContent: null, sslMode: null, unknownReason: 'zone not visible to the token' }

export function makeOrigin(overrides: Partial<OriginCert> = {}): OriginCert {
  return {
    kind: 'letsencrypt',
    subject: 'CN=app.example.com',
    issuer: 'Let\'s Encrypt · E6',
    names: ['app.example.com'],
    notBefore: NOW - 80 * DAY,
    notAfter: NOW + 10 * DAY,
    error: null,
    ...overrides
  }
}

export const originExpiringIn = (days: number, overrides: Partial<OriginCert> = {}): OriginCert =>
  makeOrigin({ notBefore: NOW + days * DAY - 90 * DAY, notAfter: NOW + days * DAY, ...overrides })

export function makeHost(overrides: Partial<HostnameStatus> = {}): HostnameStatus {
  return {
    name: 'app.example.com',
    blockId: 'app.conf:9',
    wildcard: false,
    origin: originExpiringIn(60),
    lineage: 'app.example.com',
    edge: proxiedEdge,
    verdict: 'ok',
    reason: "Let's Encrypt · 60 days left",
    uncheckedSide: null,
    ...overrides
  }
}

export function makeFacts(overrides: Partial<ServerFacts> = {}): ServerFacts {
  return {
    nginx: '1.24.0',
    openssl: '3.0.13',
    certbot: '2.11.0',
    otherWebServer: null,
    nginxParse: 'full',
    renewal: { mechanism: 'certbot.timer', lastRun: NOW - 9 * 3600, lastResult: 'success', output: 'Congratulations, all renewals succeeded.' },
    sudo: { certbot: true, nginx: true, full: false },
    paths: { certbot: '/usr/bin/certbot', nginx: '/usr/sbin/nginx' },
    user: 'deploy',
    addresses: ['203.0.113.10'],
    ...overrides
  }
}

export function makeBlock(overrides: Partial<ServerBlock> = {}): ServerBlock {
  return {
    id: 'app.conf:9',
    file: '/etc/nginx/sites-enabled/app.conf',
    line: 9,
    names: ['app.example.com'],
    tls: true,
    certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem',
    keyPath: '/etc/letsencrypt/live/app.example.com/privkey.pem',
    probeAddress: '127.0.0.1:443',
    ...overrides
  }
}

export const connectedCloudflare: CloudflareStatus = {
  saved: true,
  tokenHint: '…abcd',
  error: null,
  permissions: [{ id: 'monitoring', state: 'granted', lines: [] }],
  zones: [{ id: 'z1', name: 'example.com' }, { id: 'z2', name: 'example.net' }]
}

export function makeReport(overrides: Partial<SslReport> = {}): SslReport {
  return {
    checkedAt: NOW - 120,
    facts: makeFacts(),
    blocks: [makeBlock()],
    lineages: [],
    hostnames: [makeHost()],
    cloudflare: connectedCloudflare,
    ...overrides
  }
}
