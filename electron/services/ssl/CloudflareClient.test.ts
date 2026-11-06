import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EdgeInfo } from '../../../src/types/ssl'
import { CloudflareClient, PERMISSION_LABELS, ZONE_NOT_VISIBLE_REASON, type FetchLike } from './CloudflareClient'
import { edgesWithoutZone } from './dnsEdge'

vi.mock('./dnsEdge', () => ({ edgesWithoutZone: vi.fn(async () => ({})) }))

const TOKEN = 'test-token-123'

interface Reply {
  status?: number
  body?: unknown
}

type Routes = Record<string, Reply>

function fakeFetch(routes: Routes) {
  const calls: { path: string; init: RequestInit }[] = []
  const impl: FetchLike = async (url, init = {}) => {
    const path = url.replace('https://api.cloudflare.com/client/v4', '')
    calls.push({ path, init })
    const reply = routes[path]
    if (!reply) throw new Error(`unexpected request ${path}`)
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 })
  }
  return { impl, calls }
}

const ok = (result: unknown, totalPages = 1): Reply => ({ body: { success: true, result, result_info: { total_pages: totalPages } } })
const denied = (): Reply => ({ status: 403, body: { success: false, errors: [{ code: 9109, message: 'Unauthorized to access requested resource' }] } })

const ZONES_URL = '/zones?page=1&per_page=50'
const zone = { id: 'z1', name: 'example.com' }

const healthyRoutes = (): Routes => ({
  [ZONES_URL]: ok([{ id: 'z1', name: 'Example.com' }]),
  '/zones/z1/dns_records?per_page=5': ok([]),
  '/zones/z1/settings/ssl': ok({ id: 'ssl', value: 'strict' }),
  '/certificates?zone_id=z1&per_page=5': denied()
})

const lineStates = (permissions: { lines: { state: string }[] }[]) => permissions.map((g) => g.lines.map((l) => l.state))

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(edgesWithoutZone).mockClear()
})

describe('wording shared with the settings screen', () => {
  it('keeps the exact permission labels and the zone reason the screen matches on', async () => {
    expect(PERMISSION_LABELS).toEqual({
      zone: 'Zone → Zone → Read',
      dns: 'Zone → DNS → Read',
      zoneSettingsRead: 'Zone → Zone Settings → Read',
      sslEdit: 'Zone → SSL and Certificates → Edit',
      zoneSettingsEdit: 'Zone → Zone Settings → Edit'
    })
    expect(ZONE_NOT_VISIBLE_REASON).toBe('zone not visible to the Cloudflare token')
    const result = await new CloudflareClient(TOKEN, fakeFetch(healthyRoutes()).impl).check()
    expect(result.permissions.map((g) => g.lines.map((l) => l.label))).toEqual([
      [PERMISSION_LABELS.zone, PERMISSION_LABELS.dns, PERMISSION_LABELS.zoneSettingsRead],
      [PERMISSION_LABELS.sslEdit],
      [PERMISSION_LABELS.zoneSettingsEdit]
    ])
  })
})

describe('CloudflareClient.check', () => {
  it('reports the permissions it could prove and leaves the rest unknown', async () => {
    const { impl } = fakeFetch(healthyRoutes())
    const result = await new CloudflareClient(TOKEN, impl).check()
    expect(result.error).toBeNull()
    expect(result.zones).toEqual([zone])
    expect(result.permissions.map((g) => [g.id, g.state])).toEqual([
      ['monitoring', 'granted'],
      ['origin-ca', 'not-granted'],
      ['zone-mode', 'unknown']
    ])
    expect(result.permissions[0].lines.map((l) => l.label)).toEqual(['Zone → Zone → Read', 'Zone → DNS → Read', 'Zone → Zone Settings → Read'])
  })

  it('cannot prove the Origin CA permission when the read succeeds', async () => {
    const routes = { ...healthyRoutes(), '/certificates?zone_id=z1&per_page=5': ok([]) }
    const result = await new CloudflareClient(TOKEN, fakeFetch(routes).impl).check()
    expect(result.permissions[1]).toMatchObject({ id: 'origin-ca', state: 'unknown' })
  })

  it('marks DNS read as missing when the DNS call is refused', async () => {
    const routes = { ...healthyRoutes(), '/zones/z1/dns_records?per_page=5': denied() }
    const result = await new CloudflareClient(TOKEN, fakeFetch(routes).impl).check()
    expect(lineStates(result.permissions)[0]).toEqual(['granted', 'missing', 'granted'])
    expect(result.permissions[0].state).toBe('missing')
  })

  it('marks Zone Settings read as missing when the SSL setting is refused', async () => {
    const routes = { ...healthyRoutes(), '/zones/z1/settings/ssl': denied() }
    const result = await new CloudflareClient(TOKEN, fakeFetch(routes).impl).check()
    expect(lineStates(result.permissions)[0]).toEqual(['granted', 'granted', 'missing'])
  })

  it('treats a refused zone list as missing Zone Read, without an error', async () => {
    const { impl, calls } = fakeFetch({ [ZONES_URL]: denied() })
    const result = await new CloudflareClient(TOKEN, impl).check()
    expect(result.error).toBeNull()
    expect(result.zones).toEqual([])
    expect(lineStates(result.permissions)[0]).toEqual(['missing', 'unknown', 'unknown'])
    expect(calls).toHaveLength(1)
  })

  it('does not probe when the token sees no zones', async () => {
    const { impl, calls } = fakeFetch({ [ZONES_URL]: ok([]) })
    const result = await new CloudflareClient(TOKEN, impl).check()
    expect(lineStates(result.permissions)[0]).toEqual(['granted', 'unknown', 'unknown'])
    expect(calls).toHaveLength(1)
  })

  it('turns a rejected token into a plain sentence without the token in it', async () => {
    const { impl } = fakeFetch({ [ZONES_URL]: { status: 401, body: { success: false, errors: [{ message: 'Invalid API Token' }] } } })
    const result = await new CloudflareClient(TOKEN, impl).check()
    expect(result.error).toBe('Cloudflare rejected this token. Check that it was copied completely and has not expired or been deleted.')
    expect(result.error).not.toContain(TOKEN)
    expect(result.permissions).toEqual([])
    expect(result.zones).toEqual([])
  })

  it('reports a rejected token even when a later probe is the one refused with 401', async () => {
    const routes = { ...healthyRoutes(), '/zones/z1/settings/ssl': { status: 401 } }
    const result = await new CloudflareClient(TOKEN, fakeFetch(routes).impl).check()
    expect(result.error).toContain('rejected this token')
  })

  it('leaves a permission unknown when its probe fails for another reason', async () => {
    const routes = { ...healthyRoutes(), '/zones/z1/dns_records?per_page=5': { status: 500 } }
    const result = await new CloudflareClient(TOKEN, fakeFetch(routes).impl).check()
    expect(lineStates(result.permissions)[0]).toEqual(['granted', 'unknown', 'granted'])
  })

  it('explains rate limiting and server trouble', async () => {
    const limited = await new CloudflareClient(TOKEN, fakeFetch({ [ZONES_URL]: { status: 429 } }).impl).check()
    expect(limited.error).toContain('limiting requests')
    const broken = await new CloudflareClient(TOKEN, fakeFetch({ [ZONES_URL]: { status: 502 } }).impl).check()
    expect(broken.error).toContain('error 502')
  })

  it('reports an unreachable Cloudflare', async () => {
    const impl: FetchLike = async () => {
      throw new TypeError('fetch failed')
    }
    const result = await new CloudflareClient(TOKEN, impl).check()
    expect(result.error).toBe("Could not reach Cloudflare. Check this PC's internet connection.")
  })

  it('gives up after 15 seconds', async () => {
    vi.useFakeTimers()
    const impl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const pending = new CloudflareClient(TOKEN, impl).check()
    await vi.advanceTimersByTimeAsync(15_000)
    expect((await pending).error).toBe('Cloudflare did not answer within 15 seconds.')
  })

  it('reports an account with more zones than the hard cap instead of truncating', async () => {
    const routes: Routes = {}
    for (let page = 1; page <= 12; page++) routes[`/zones?page=${page}&per_page=50`] = ok([{ id: `z${page}`, name: `site${page}.example.com` }], 99)
    const { impl, calls } = fakeFetch(routes)
    const result = await new CloudflareClient(TOKEN, impl).check()
    expect(result.error).toContain('more zones than Shellway can list')
    expect(result.zones).toEqual([])
    expect(calls.filter((c) => c.path.startsWith('/zones?'))).toHaveLength(10)
  })

  it('stops paging at the last page', async () => {
    const routes: Routes = {
      '/zones?page=1&per_page=50': ok([{ id: 'z1', name: 'example.com' }], 2),
      '/zones?page=2&per_page=50': ok([{ id: 'z2', name: 'example.org' }], 2),
      '/zones/z1/dns_records?per_page=5': ok([]),
      '/zones/z1/settings/ssl': ok({ value: 'full' }),
      '/certificates?zone_id=z1&per_page=5': denied()
    }
    const result = await new CloudflareClient(TOKEN, fakeFetch(routes).impl).check()
    expect(result.zones.map((z) => z.name)).toEqual(['example.com', 'example.org'])
  })

  it('only reads: GET with a bearer token, no body', async () => {
    const { impl, calls } = fakeFetch(healthyRoutes())
    await new CloudflareClient(TOKEN, impl).check()
    expect(calls.length).toBeGreaterThan(0)
    for (const { init } of calls) {
      expect(init.method ?? 'GET').toBe('GET')
      expect(init.body).toBeUndefined()
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    }
  })
})

const RECORD_URL = (host: string) => `/zones/z1/dns_records?name=${host}&per_page=100`
const record = (type: string, name: string, content: string, proxied: boolean) => ({ type, name, content, proxied })
const SERVER = ['203.0.113.10']

async function edgesFor(routes: Routes, hosts: string[], zones = [zone], addresses = SERVER) {
  const { impl, calls } = fakeFetch(routes)
  const edges = await new CloudflareClient(TOKEN, impl).edges(hosts, addresses, zones)
  return { edges, calls }
}

describe('CloudflareClient.edges', () => {
  it('reports a proxied record with the zone SSL mode', async () => {
    const routes = {
      '/zones/z1/settings/ssl': ok({ value: 'strict' }),
      [RECORD_URL('app.example.com')]: ok([record('A', 'app.example.com', '203.0.113.10', true)])
    }
    const { edges } = await edgesFor(routes, ['app.example.com'])
    expect(edges['app.example.com']).toEqual({
      state: 'proxied',
      zone: 'example.com',
      recordType: 'A',
      recordContent: '203.0.113.10',
      sslMode: 'strict',
      unknownReason: null
    })
  })

  it('reports a DNS-only record', async () => {
    const routes = {
      '/zones/z1/settings/ssl': ok({ value: 'full' }),
      [RECORD_URL('app.example.com')]: ok([record('CNAME', 'app.example.com', 'origin.example.com', false)])
    }
    const { edges } = await edgesFor(routes, ['app.example.com'])
    expect(edges['app.example.com']).toMatchObject({ state: 'dns-only', recordType: 'CNAME', sslMode: 'full' })
  })

  it('reports elsewhere when an address record is not this server', async () => {
    const routes = {
      '/zones/z1/settings/ssl': ok({ value: 'full' }),
      [RECORD_URL('app.example.com')]: ok([record('A', 'app.example.com', '198.51.100.7', true)])
    }
    const { edges } = await edgesFor(routes, ['app.example.com'])
    expect(edges['app.example.com']).toMatchObject({ state: 'elsewhere', recordContent: '198.51.100.7' })
  })

  it('does not call it elsewhere when the server addresses are unknown', async () => {
    const routes = {
      '/zones/z1/settings/ssl': ok({ value: 'full' }),
      [RECORD_URL('app.example.com')]: ok([record('A', 'app.example.com', '198.51.100.7', true)])
    }
    const { edges } = await edgesFor(routes, ['app.example.com'], [zone], [])
    expect(edges['app.example.com'].state).toBe('proxied')
  })

  it('ignores records of other names and other types', async () => {
    const routes = {
      '/zones/z1/settings/ssl': ok({ value: 'full' }),
      [RECORD_URL('app.example.com')]: ok([record('TXT', 'app.example.com', 'v=spf1', false), record('A', 'www.example.com', '203.0.113.10', true)])
    }
    const { edges } = await edgesFor(routes, ['app.example.com'])
    expect(edges['app.example.com']).toMatchObject({ state: 'unknown', unknownReason: 'no DNS record found', zone: 'example.com', sslMode: 'full' })
  })

  it('matches a host to the longest zone suffix', async () => {
    const routes = {
      '/zones/z2/settings/ssl': ok({ value: 'flexible' }),
      '/zones/z2/dns_records?name=a.sub.example.com&per_page=100': ok([record('A', 'a.sub.example.com', '203.0.113.10', true)])
    }
    const zones = [zone, { id: 'z2', name: 'sub.example.com' }]
    const { edges } = await edgesFor(routes, ['a.sub.example.com'], zones)
    expect(edges['a.sub.example.com']).toMatchObject({ zone: 'sub.example.com', sslMode: 'flexible' })
  })

  it('does not treat a lookalike suffix as the same zone', async () => {
    const { edges, calls } = await edgesFor({}, ['badexample.com'])
    expect(calls).toHaveLength(0)
    expect(edges).toEqual({})
    expect(edgesWithoutZone).toHaveBeenCalledWith(['badexample.com'], SERVER, ZONE_NOT_VISIBLE_REASON)
  })

  it('reads each zone SSL setting once', async () => {
    const routes = {
      '/zones/z1/settings/ssl': ok({ value: 'strict' }),
      [RECORD_URL('a.example.com')]: ok([record('A', 'a.example.com', '203.0.113.10', true)]),
      [RECORD_URL('b.example.com')]: ok([record('A', 'b.example.com', '203.0.113.10', false)])
    }
    const { edges, calls } = await edgesFor(routes, ['a.example.com', 'b.example.com'])
    expect(calls.filter((c) => c.path.endsWith('/settings/ssl'))).toHaveLength(1)
    expect(edges['b.example.com'].sslMode).toBe('strict')
  })

  it('stops asking about more hostnames once Cloudflare rate-limits the token', async () => {
    const limited: Reply = { status: 429, body: { success: false, errors: [{ message: 'Rate limited' }] } }
    const routes = {
      '/zones/z1/settings/ssl': ok({ value: 'strict' }),
      [RECORD_URL('a.example.com')]: limited,
      [RECORD_URL('b.example.com')]: ok([])
    }
    const { impl, calls } = fakeFetch(routes)
    await expect(new CloudflareClient(TOKEN, impl).edges(['a.example.com', 'b.example.com'], [], [zone])).rejects.toThrow(/limiting requests/)
    expect(calls.some((c) => c.path === RECORD_URL('b.example.com'))).toBe(false)
  })

  it('keeps the edge with no SSL mode when the setting cannot be read', async () => {
    const routes = {
      '/zones/z1/settings/ssl': denied(),
      [RECORD_URL('app.example.com')]: ok([record('A', 'app.example.com', '203.0.113.10', true)])
    }
    const { edges } = await edgesFor(routes, ['app.example.com'])
    expect(edges['app.example.com']).toMatchObject({ state: 'proxied', sslMode: null })
  })

  it('ignores an SSL value it does not know', async () => {
    const routes = {
      '/zones/z1/settings/ssl': ok({ value: 'something_new' }),
      [RECORD_URL('app.example.com')]: ok([record('A', 'app.example.com', '203.0.113.10', true)])
    }
    const { edges } = await edgesFor(routes, ['app.example.com'])
    expect(edges['app.example.com'].sslMode).toBeNull()
  })

  it('explains a refused DNS read for that host only', async () => {
    const routes = {
      '/zones/z1/settings/ssl': ok({ value: 'full' }),
      [RECORD_URL('a.example.com')]: denied(),
      [RECORD_URL('b.example.com')]: ok([record('A', 'b.example.com', '203.0.113.10', true)])
    }
    const { edges } = await edgesFor(routes, ['a.example.com', 'b.example.com'])
    expect(edges['a.example.com']).toMatchObject({ state: 'unknown', zone: 'example.com' })
    expect(edges['a.example.com'].unknownReason).toContain('Zone → DNS → Read')
    expect(edges['b.example.com'].state).toBe('proxied')
  })

  it('hands hosts outside every visible zone to the DNS fallback and merges the result', async () => {
    const fallback: EdgeInfo = { state: 'not-on-cloudflare', zone: null, recordType: 'A', recordContent: '203.0.113.10', sslMode: null, unknownReason: null }
    vi.mocked(edgesWithoutZone).mockResolvedValueOnce({ 'x.example.net': fallback })
    const routes = {
      '/zones/z1/settings/ssl': ok({ value: 'full' }),
      [RECORD_URL('app.example.com')]: ok([record('A', 'app.example.com', '203.0.113.10', true)])
    }
    const { edges } = await edgesFor(routes, ['app.example.com', 'x.example.net'])
    expect(edgesWithoutZone).toHaveBeenCalledWith(['x.example.net'], SERVER, ZONE_NOT_VISIBLE_REASON)
    expect(edges['x.example.net']).toBe(fallback)
    expect(edges['app.example.com'].state).toBe('proxied')
  })
})

describe('CloudflareClient.createOriginCert', () => {
  const PEM = '-----BEGIN CERTIFICATE-----\nMIIBsample\n-----END CERTIFICATE-----\n'
  const CSR = '-----BEGIN CERTIFICATE REQUEST-----\nMIIBcsr\n-----END CERTIFICATE REQUEST-----\n'
  const NAMES = ['app.example.com', 'www.example.com']
  const issued = (extra: object = {}): Reply => ({ body: { success: true, result: { id: 'c1', certificate: PEM, expires_on: '2041-11-06 12:30:00 +0000 UTC', ...extra } } })

  it('posts the request with a bearer token and returns the certificate and expiry', async () => {
    const { impl, calls } = fakeFetch({ '/certificates': issued() })

    const result = await new CloudflareClient(TOKEN, impl).createOriginCert(CSR, NAMES, 'ecc', 15)

    expect(result).toEqual({ certificate: PEM, notAfter: Date.UTC(2041, 10, 6, 12, 30, 0) / 1000 })
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('POST')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ csr: CSR, hostnames: NAMES, request_type: 'origin-ecc', requested_validity: 5475 })
  })

  it.each([
    ['ecc', 1, 'origin-ecc', 365],
    ['rsa', 2, 'origin-rsa', 730],
    ['rsa', 3, 'origin-rsa', 1095],
    ['ecc', 15, 'origin-ecc', 5475]
  ] as const)('maps %s and %i years to %s and %i days', async (keyType, years, requestType, days) => {
    const { impl, calls } = fakeFetch({ '/certificates': issued() })
    await new CloudflareClient(TOKEN, impl).createOriginCert(CSR, NAMES, keyType, years)
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ request_type: requestType, requested_validity: days })
  })

  it('reads an ISO expiry date and tolerates a missing one', async () => {
    const iso = fakeFetch({ '/certificates': issued({ expires_on: '2041-11-06T12:30:00Z' }) })
    expect((await new CloudflareClient(TOKEN, iso.impl).createOriginCert(CSR, NAMES, 'ecc', 15)).notAfter).toBe(Date.UTC(2041, 10, 6, 12, 30, 0) / 1000)
    const none = fakeFetch({ '/certificates': issued({ expires_on: undefined }) })
    expect((await new CloudflareClient(TOKEN, none.impl).createOriginCert(CSR, NAMES, 'ecc', 15)).notAfter).toBeNull()
  })

  it('explains a 403 plainly and never retries', async () => {
    const { impl, calls } = fakeFetch({ '/certificates': denied() })
    await expect(new CloudflareClient(TOKEN, impl).createOriginCert(CSR, NAMES, 'ecc', 15)).rejects.toThrow('needs Zone → SSL and Certificates → Edit')
    expect(calls).toHaveLength(1)
  })

  it.each([[401, 'rejected this token'], [429, 'limiting requests'], [500, 'had a problem']])('reports a %i plainly and never retries', async (status, text) => {
    const { impl, calls } = fakeFetch({ '/certificates': { status, body: { success: false } } })
    await expect(new CloudflareClient(TOKEN, impl).createOriginCert(CSR, NAMES, 'ecc', 15)).rejects.toThrow(text)
    expect(calls).toHaveLength(1)
  })

  it('shows the message Cloudflare gave for a rejected request', async () => {
    const { impl } = fakeFetch({ '/certificates': { status: 400, body: { success: false, errors: [{ message: 'Invalid CSR' }] } } })
    await expect(new CloudflareClient(TOKEN, impl).createOriginCert(CSR, NAMES, 'ecc', 15)).rejects.toThrow('Cloudflare answered: Invalid CSR')
  })

  it('refuses an answer without a certificate and a bad number of names, without calling Cloudflare for the names', async () => {
    const { impl, calls } = fakeFetch({ '/certificates': { body: { success: true, result: {} } } })
    const client = new CloudflareClient(TOKEN, impl)
    await expect(client.createOriginCert(CSR, NAMES, 'ecc', 15)).rejects.toThrow('did not return a certificate')
    await expect(client.createOriginCert(CSR, [], 'ecc', 15)).rejects.toThrow('between 1 and 200')
    await expect(client.createOriginCert(CSR, Array.from({ length: 201 }, (_, i) => `h${i}.example.com`), 'ecc', 15)).rejects.toThrow('between 1 and 200')
    expect(calls).toHaveLength(1)
  })
})

describe('CloudflareClient zone SSL mode', () => {
  const record = (type: string, name: string, content: string, proxied: boolean) => ({ type, name, content, proxied })
  const RECORDS_URL = (page: number) => `/zones/z1/dns_records?page=${page}&per_page=100`

  it('lists only proxied A, AAAA and CNAME records across pages', async () => {
    const { impl, calls } = fakeFetch({
      [RECORDS_URL(1)]: ok([record('A', 'App.example.com', '203.0.113.10', true), record('A', 'direct.example.com', '203.0.113.11', false), record('TXT', 'example.com', 'v=spf1', true)], 2),
      [RECORDS_URL(2)]: ok([record('CNAME', 'www.example.com', 'app.example.com', true), record('AAAA', 'v6.example.com', '2001:db8::1', true), record('MX', 'example.com', 'mail.example.com', true)], 2)
    })
    const records = await new CloudflareClient(TOKEN, impl).listProxiedRecords('z1')
    expect(records).toEqual([
      { type: 'A', name: 'app.example.com', content: '203.0.113.10' },
      { type: 'CNAME', name: 'www.example.com', content: 'app.example.com' },
      { type: 'AAAA', name: 'v6.example.com', content: '2001:db8::1' }
    ])
    expect(calls).toHaveLength(2)
  })

  it('refuses to check a zone with more records than the page limit allows', async () => {
    const routes: Routes = {}
    for (let page = 1; page <= 12; page++) routes[RECORDS_URL(page)] = ok([], 50)
    const { impl, calls } = fakeFetch(routes)
    await expect(new CloudflareClient(TOKEN, impl).listProxiedRecords('z1')).rejects.toThrow('more DNS records than Shellway can check (over 1000)')
    expect(calls).toHaveLength(10)
  })

  it('accepts a zone that fills exactly the page limit', async () => {
    const routes: Routes = {}
    for (let page = 1; page <= 10; page++) routes[RECORDS_URL(page)] = ok([], 10)
    const { impl, calls } = fakeFetch(routes)
    expect(await new CloudflareClient(TOKEN, impl).listProxiedRecords('z1')).toEqual([])
    expect(calls).toHaveLength(10)
  })

  it('refuses a full page when the API omits the page count', async () => {
    const full = Array.from({ length: 100 }, (_, i) => record('A', `h${i}.example.com`, '203.0.113.10', true))
    const { impl } = fakeFetch({ [RECORDS_URL(1)]: { body: { success: true, result: full } } })
    await expect(new CloudflareClient(TOKEN, impl).listProxiedRecords('z1')).rejects.toThrow('more DNS records than Shellway can check')
  })

  it('accepts a short page when the API omits the page count', async () => {
    const { impl } = fakeFetch({ [RECORDS_URL(1)]: { body: { success: true, result: [record('A', 'a.example.com', '203.0.113.10', true)] } } })
    expect(await new CloudflareClient(TOKEN, impl).listProxiedRecords('z1')).toHaveLength(1)
  })

  it('refuses to list zones past the page limit', async () => {
    const routes: Routes = {}
    for (let page = 1; page <= 10; page++) routes[`/zones?page=${page}&per_page=50`] = ok([], 11)
    const { impl } = fakeFetch(routes)
    await expect(new CloudflareClient(TOKEN, impl).findZone('example.com')).rejects.toThrow('more zones than Shellway can list')
  })

  it('explains a denied record list and does not retry', async () => {
    const { impl, calls } = fakeFetch({ [RECORDS_URL(1)]: denied() })
    await expect(new CloudflareClient(TOKEN, impl).listProxiedRecords('z1')).rejects.toThrow('needs DNS · Read')
    expect(calls).toHaveLength(1)
  })

  it('changes the mode with a PATCH carrying the value', async () => {
    const { impl, calls } = fakeFetch({ '/zones/z1/settings/ssl': ok({ id: 'ssl', value: 'strict' }) })
    await new CloudflareClient(TOKEN, impl).setSslMode('z1', 'strict')
    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ value: 'strict' })
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('uses the Zone Settings wording for a denied PATCH and the plain wording for a bad token', async () => {
    const forbidden = fakeFetch({ '/zones/z1/settings/ssl': denied() })
    await expect(new CloudflareClient(TOKEN, forbidden.impl).setSslMode('z1', 'strict')).rejects.toThrow('The Cloudflare token needs Zone Settings · Edit to change the SSL mode.')
    const rejected = fakeFetch({ '/zones/z1/settings/ssl': { status: 401, body: { success: false } } })
    await expect(new CloudflareClient(TOKEN, rejected.impl).setSslMode('z1', 'strict')).rejects.toThrow('rejected this token')
    expect(forbidden.calls).toHaveLength(1)
  })

  it('refuses to send a mode Cloudflare cannot be set to here', async () => {
    const { impl, calls } = fakeFetch({})
    await expect(new CloudflareClient(TOKEN, impl).setSslMode('z1', 'origin_pull')).rejects.toThrow('cannot be set')
    expect(calls).toHaveLength(0)
  })

  it('reads the current mode and finds a zone by name', async () => {
    const { impl } = fakeFetch({
      '/zones/z1/settings/ssl': ok({ id: 'ssl', value: 'full' }),
      [ZONES_URL]: ok([{ id: 'z1', name: 'Example.com' }])
    })
    const client = new CloudflareClient(TOKEN, impl)
    expect(await client.currentSslMode('z1')).toBe('full')
    expect(await client.findZone('EXAMPLE.com')).toEqual(zone)
    await expect(client.findZone('other.example.net')).rejects.toThrow('not a zone in this Cloudflare account')
  })
})
