import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OriginCert, ServerScan } from '../../../src/types/ssl'
import type { CloudflareClient } from './CloudflareClient'
import { SslCoordinator, type SslDeps } from './SslCoordinator'
import type { SslService } from './SslService'
import type { KnownHost, SslLocalStore } from './SslLocalStore'
import { unknownEdge } from './report'

const NOW_MS = 1_800_000_000_000
const DAY = 86_400

const cert = (days: number): OriginCert => ({
  kind: 'letsencrypt', subject: 'CN=app.example.com', issuer: 'CN=R11', names: ['app.example.com', 'api.example.com'],
  notBefore: NOW_MS / 1000 - DAY, notAfter: NOW_MS / 1000 + days * DAY, error: null
})

const scan = (days: number): ServerScan => ({
  facts: {
    nginx: '1.24.0', openssl: '3.0.13', certbot: '2.11.0', otherWebServer: null, nginxParse: 'full',
    renewal: { mechanism: 'certbot.timer', lastRun: null, lastResult: 'failed', output: '' },
    sudo: { certbot: true, nginx: true, full: false }, paths: { certbot: '/usr/bin/certbot', nginx: '/usr/sbin/nginx' },
    user: 'deploy', addresses: ['203.0.113.10']
  },
  blocks: [{
    id: 'app.conf:1', file: '/etc/nginx/sites-enabled/app.conf', line: 1, names: ['app.example.com', 'api.example.com', '*.example.com'],
    tls: true, certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem', keyPath: '', probeAddress: '127.0.0.1:443', root: null
  }],
  lineages: [{ name: 'app.example.com', domains: ['app.example.com', 'api.example.com'], notAfter: null, certPath: '/etc/letsencrypt/live/app.example.com/fullchain.pem', keyPath: '' }],
  origins: { 'app.example.com': cert(days), 'api.example.com': cert(days) }
})

function fakeStore(known: Record<string, KnownHost[]> = {}, token: string | null = null) {
  const hosts = { ...known }
  return {
    hosts,
    cloudflareToken: () => token,
    setCloudflareToken: vi.fn(),
    knownHosts: () => hosts,
    setKnownHosts: (sessionId: string, list: KnownHost[]) => { hosts[sessionId] = list }
  } as unknown as SslLocalStore & { hosts: Record<string, KnownHost[]> }
}

let scanDays: number
let scanCalls: number
let edgeAddresses: string[]
let deps: SslDeps & { notify: ReturnType<typeof vi.fn>; broadcast: ReturnType<typeof vi.fn> }

function coordinator(store = fakeStore(), cloudflare?: Partial<CloudflareClient>): SslCoordinator {
  deps = {
    execFor: (id) => (id === 'c1' ? vi.fn() : null),
    store,
    cloudflare: () => cloudflare as CloudflareClient,
    serviceFor: () => ({ scan: async () => { scanCalls++; return scan(scanDays) } }) as unknown as SslService,
    edgesWithoutToken: async (hosts, addresses, reason) => {
      edgeAddresses = addresses
      return Object.fromEntries(hosts.map((h) => [h, unknownEdge(reason)]))
    },
    resolveHost: async (host) => (host === 'server-a.example.com' ? ['198.51.100.7'] : []),
    broadcast: vi.fn(),
    notify: vi.fn(),
    now: () => NOW_MS
  }
  return new SslCoordinator(deps)
}

describe('SslCoordinator', () => {
  beforeEach(() => {
    scanDays = 5
    scanCalls = 0
  })

  it('builds the report without a token and remembers the hosts to probe', async () => {
    const store = fakeStore()
    const report = await coordinator(store).check('c1', 's1')
    expect(report.hostnames.map((h) => [h.name, h.verdict])).toEqual([
      ['api.example.com', 'will-break'], ['app.example.com', 'will-break'], ['*.example.com', 'unchecked']
    ])
    expect(report.cloudflare.saved).toBe(false)
    expect(store.hosts.s1).toEqual([
      { host: 'app.example.com', address: '203.0.113.10', port: 443 },
      { host: 'api.example.com', address: '203.0.113.10', port: 443 }
    ])
    expect(deps.broadcast).toHaveBeenCalledWith('ssl:critical', 'c1', 2)
  })

  it('shares one check between concurrent callers', async () => {
    const ssl = coordinator()
    await Promise.all([ssl.check('c1', 's1'), ssl.check('c1', 's1')])
    expect(scanCalls).toBe(1)
  })

  it('warns once on connect for servers that were checked before, naming the worst hostname', async () => {
    const ssl = coordinator(fakeStore({ s1: [] }))
    await ssl.onConnected('c1', 's1', 'server-a', '')
    expect(deps.notify).toHaveBeenCalledWith('SSL problem on server-a', 'api.example.com: Expires in 5 days and renewal is not working\n1 more hostname needs attention')
    expect(ssl.criticalCount('c1')).toBe(2)
  })

  it('does not check servers that never opened the SSL tab, and stays quiet when all is well', async () => {
    await coordinator(fakeStore()).onConnected('c1', 's1', 'server-a', '')
    expect(scanCalls).toBe(0)
    scanDays = 60
    await coordinator(fakeStore({ s1: [] })).onConnected('c1', 's1', 'server-a', '')
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('counts the address Shellway connected to as the server, for clouds that only report a private address', async () => {
    const store = fakeStore({ s1: [] })
    await coordinator(store).onConnected('c1', 's1', 'server-a', 'server-a.example.com')
    expect(edgeAddresses).toEqual(['198.51.100.7', '203.0.113.10'])
    expect(store.hosts.s1[0]).toMatchObject({ host: 'app.example.com', address: '198.51.100.7' })
  })

  it('warns once when the connection drops and reconnects', async () => {
    const ssl = coordinator(fakeStore({ s1: [] }))
    await ssl.onConnected('c1', 's1', 'server-a', '')
    await ssl.onConnected('c1', 's1', 'server-a', '')
    expect(deps.notify).toHaveBeenCalledTimes(1)
  })

  it('does not raise the alert dot for a connection that closed during the check', async () => {
    const ssl = coordinator()
    let connected = true
    deps.execFor = () => (connected ? vi.fn() : null)
    deps.serviceFor = () => ({ scan: async () => { connected = false; return scan(5) } }) as unknown as SslService
    await ssl.check('c1', 's1')
    expect(deps.broadcast).not.toHaveBeenCalled()
    expect(ssl.criticalCount('c1')).toBe(0)
  })

  it('marks the Cloudflare side unknown when the token check fails', async () => {
    const cloudflare = { check: async () => { throw new Error('Invalid API token') }, edges: vi.fn() }
    const report = await coordinator(fakeStore({}, 'test-token-123'), cloudflare).check('c1', 's1')
    expect(report.cloudflare).toMatchObject({ saved: true, tokenHint: '…-123', error: 'Invalid API token' })
    expect(report.hostnames[0].edge).toMatchObject({ state: 'unknown', unknownReason: 'Invalid API token' })
    expect(cloudflare.edges).not.toHaveBeenCalled()
  })

  it('runs one certbot command per server at a time', async () => {
    let finish: () => void = () => {}
    const ssl = coordinator()
    deps.serviceFor = () => ({ runCertbot: () => new Promise((resolve) => { finish = () => resolve({ code: 0, output: '' }) }) }) as unknown as SslService
    const first = ssl.runCertbot('c1', 'app.example.com', 'test', 'run-1')
    await expect(ssl.runCertbot('c1', 'app.example.com', 'renew', 'run-2')).rejects.toThrow(/already running/)
    finish()
    await first
    const again = ssl.runCertbot('c1', 'app.example.com', 'renew', 'run-3')
    finish()
    await expect(again).resolves.toEqual({ code: 0, output: '' })
  })

  it('keeps the saved token when a new one is rejected', async () => {
    const store = fakeStore({}, 'old-token')
    const cloudflare = { check: async () => ({ error: 'Cloudflare rejected this token.', permissions: [], zones: [] }) }
    await expect(coordinator(store, cloudflare).saveCloudflareToken('bad-token')).rejects.toThrow('Cloudflare rejected this token.')
    expect(store.setCloudflareToken).not.toHaveBeenCalled()
  })

  it('refuses to work on a closed connection', async () => {
    await expect(coordinator().check('c2', 's1')).rejects.toThrow(/Not connected/)
  })
})
