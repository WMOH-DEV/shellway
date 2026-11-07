import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IssueRequest, OriginCert, ServerScan } from '../../../src/types/ssl'
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
  const emails: Record<string, string> = {}
  return {
    hosts,
    cloudflareToken: () => token,
    setCloudflareToken: vi.fn(),
    knownHosts: () => hosts,
    setKnownHosts: (sessionId: string, list: KnownHost[]) => { hosts[sessionId] = list },
    emails,
    httpsEmail: (sessionId: string) => emails[sessionId] ?? '',
    setHttpsEmail: (sessionId: string, email: string) => { emails[sessionId] = email }
  } as unknown as SslLocalStore & { hosts: Record<string, KnownHost[]>; emails: Record<string, string> }
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

  it('keeps the last report per connection and drops it when the connection closes', async () => {
    const ssl = coordinator()
    expect(ssl.lastReport('c1')).toBeNull()
    const report = await ssl.check('c1', 's1')
    expect(ssl.lastReport('c1')).toBe(report)
    expect(ssl.lastReport('c2')).toBeNull()
    ssl.forget('c1')
    expect(ssl.lastReport('c1')).toBeNull()
  })

  it('refuses every certificate task while one is running on the server', async () => {
    let finish: () => void = () => {}
    const ssl = coordinator()
    const httpsRequest: IssueRequest = { blockId: 'app.conf:1', names: ['app.example.com'], email: 'admin@example.com', redirect: true, staging: true }
    deps.httpGet = async () => ({ status: 200 })
    deps.serviceFor = () => ({
      runCertbot: () => new Promise((resolve) => { finish = () => resolve({ code: 0, output: '' }) }),
      readConfig: async () => ({ facts: {}, blocks: [] }),
      probeNames: async () => ({})
    }) as unknown as SslService
    const running = ssl.runCertbot('c1', 'app.example.com', 'test', 'run-1')

    await expect(ssl.httpsInstall('c1', 'snap', 'run-2')).rejects.toThrow(/already running/)
    await expect(ssl.httpsIssue('c1', 's1', httpsRequest, 'run-3')).rejects.toThrow(/already running/)
    const verified = await ssl.httpsVerify('c1', ['app.example.com'], 'app.example.com')
    expect(verified.renewalTest).toMatchObject({ state: 'fail', detail: expect.stringMatching(/already running/) })

    finish()
    await running
  })

  it('runs an issue through the connection, streams it under the run id and remembers the email for the session', async () => {
    const store = fakeStore()
    const ssl = coordinator(store)
    const commands: string[] = []
    deps.execFor = () => async (command, options) => {
      commands.push(command)
      options?.onOutput?.(`ran ${command}\n`)
      return { stdout: '', stdoutBytes: 0, stderr: '', code: 0 }
    }
    deps.serviceFor = () => ({
      readConfig: async () => ({ facts: { nginxParse: 'full', sudo: { full: true } }, blocks: [{ id: 'app.conf:1', file: '/etc/nginx/sites-enabled/app.conf', names: ['app.example.com'] }] })
    }) as unknown as SslService

    expect(ssl.httpsEmail('s1')).toBe('')
    const result = await ssl.httpsIssue('c1', 's1', { blockId: 'app.conf:1', names: ['app.example.com'], email: 'admin@example.com', redirect: false, staging: false }, 'run-9')

    expect(result).toMatchObject({ ok: true, lineage: 'app.example.com' })
    expect(commands).toEqual(['sudo -n sh -s', 'sudo -n timeout -k 10 570 certbot --nginx --non-interactive --agree-tos -m admin@example.com --cert-name app.example.com -d app.example.com --no-redirect', 'sudo -n nginx -t'])
    expect(deps.broadcast).toHaveBeenCalledWith('ssl:output', 'run-9', 'ran sudo -n nginx -t\n')
    expect(ssl.httpsEmail('s1')).toBe('admin@example.com')
    await expect(ssl.httpsInstall('c1', 'snap', 'run-10')).rejects.not.toThrow(/already running/)
  })

  it('checks readiness against the connected address and the Cloudflare record of a proxied name', async () => {
    const cloudflare = {
      check: async () => ({ error: null, permissions: [], zones: [{ id: 'z1', name: 'example.com' }] }),
      edges: vi.fn(async () => ({ 'app.example.com': { state: 'proxied', zone: 'example.com', recordType: 'A', recordContent: '203.0.113.10', sslMode: 'flexible', unknownReason: null } }))
    }
    const ssl = coordinator(fakeStore({}, 'test-token-123'), cloudflare as unknown as CloudflareClient)
    deps.serviceFor = () => ({ readFacts: async () => ({ addresses: ['203.0.113.10'] }) }) as unknown as SslService
    deps.resolveHost = async (host) => (host === 'app.example.com' ? ['104.18.1.1'] : [])
    deps.httpGet = async () => ({ status: 404 })

    const result = await ssl.httpsReadiness('c1', ['app.example.com'])

    expect(result).toEqual([{
      name: 'app.example.com',
      dns: { state: 'ok', detail: 'proxied by Cloudflare, record points to this server' },
      port80: { state: 'ok', detail: 'answers on port 80' },
      cloudflare: 'Cloudflare SSL mode: Flexible'
    }])
    expect(cloudflare.edges).toHaveBeenCalledWith(['app.example.com'], ['203.0.113.10'], [{ id: 'z1', name: 'example.com' }])
  })

  it('rejects names that are not plain hostnames before doing any work', async () => {
    const ssl = coordinator()
    await expect(ssl.httpsReadiness('c1', ['app.example.com; rm -rf /'])).rejects.toThrow(/not a valid hostname/)
    expect(() => ssl.httpsVerify('c1', ['*.example.com'], 'app.example.com')).toThrow(/not a valid hostname/)
    expect(() => ssl.httpsVerify('c1', ['app.example.com'], '../etc')).toThrow('Invalid certificate name')
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
