import { describe, expect, it, vi } from 'vitest'
import type { EdgeInfo, ReadinessCheck } from '../../../../src/types/ssl'
import { checkReadiness } from './readiness'
import type { ReadinessDeps } from './readiness'

const SERVER = ['203.0.113.10']
const NAME = 'app.example.com'

const answers = (status: number) => async () => ({ status })
const failing = (code: string, message = code) => async () => { throw Object.assign(new Error(message), { code }) }

function deps(overrides: Partial<ReadinessDeps> = {}): ReadinessDeps {
  return {
    serverAddresses: SERVER,
    resolve: async () => SERVER,
    httpGet: answers(404),
    edgesOf: async () => null,
    ...overrides
  }
}

const edge = (overrides: Partial<EdgeInfo>): EdgeInfo => ({
  state: 'proxied', zone: 'example.com', recordType: 'A', recordContent: SERVER[0], sslMode: null, unknownReason: null, ...overrides
})

const dnsOf = async (overrides: Partial<ReadinessDeps>): Promise<ReadinessCheck> => (await checkReadiness([NAME], deps(overrides)))[0].dns
const port80Of = async (overrides: Partial<ReadinessDeps>): Promise<ReadinessCheck> => (await checkReadiness([NAME], deps(overrides)))[0].port80

describe('checkReadiness DNS', () => {
  it('accepts a name that points at this server, ignoring address case', async () => {
    expect(await dnsOf({})).toEqual({ state: 'ok', detail: 'points to this server' })
    expect(await dnsOf({ serverAddresses: ['2001:DB8::1'], resolve: async () => ['2001:db8::1'] })).toMatchObject({ state: 'ok' })
  })

  it('fails with the address it points to when it is not this server', async () => {
    expect(await dnsOf({ resolve: async () => ['198.51.100.7'] })).toEqual({ state: 'fail', detail: 'points to 198.51.100.7, not this server' })
  })

  it('names the non-Cloudflare address of a mixed answer', async () => {
    expect(await dnsOf({ resolve: async () => ['104.18.1.1', '198.51.100.7'] })).toEqual({ state: 'fail', detail: 'points to 198.51.100.7, not this server' })
  })

  it('fails when the name has no DNS record', async () => {
    const missing = { state: 'fail', detail: 'no DNS record for this name' }
    expect(await dnsOf({ resolve: async () => [] })).toEqual(missing)
    expect(await dnsOf({ resolve: failing('ENOTFOUND') })).toEqual(missing)
    expect(await dnsOf({ resolve: failing('ENODATA') })).toEqual(missing)
  })

  it('does not fail the name for a lookup that merely timed out', async () => {
    expect(await dnsOf({ resolve: failing('ETIMEOUT') })).toEqual({ state: 'unknown', detail: 'DNS lookup failed (ETIMEOUT)' })
  })

  it('cannot judge a direct address when the server addresses are unknown', async () => {
    expect(await dnsOf({ serverAddresses: [], resolve: async () => ['198.51.100.7'] })).toMatchObject({ state: 'unknown' })
  })

  it('is unknown behind Cloudflare without a token', async () => {
    const edgesOf = vi.fn(async () => null)
    expect(await dnsOf({ resolve: async () => ['104.18.1.1'], edgesOf })).toEqual({
      state: 'unknown', detail: 'behind Cloudflare; add a Cloudflare token to confirm it points here'
    })
    expect(edgesOf).toHaveBeenCalledWith([NAME])
  })

  it('uses the Cloudflare record when the zone is visible', async () => {
    const proxied = await checkReadiness([NAME], deps({
      resolve: async () => ['104.18.1.1'],
      edgesOf: async () => ({ [NAME]: edge({ sslMode: 'flexible' }) })
    }))
    expect(proxied[0].dns).toEqual({ state: 'ok', detail: 'proxied by Cloudflare, record points to this server' })
    expect(proxied[0].cloudflare).toBe('Cloudflare SSL mode: Flexible')

    const elsewhere = await dnsOf({
      resolve: async () => ['104.18.1.1'],
      edgesOf: async () => ({ [NAME]: edge({ state: 'elsewhere', recordContent: '198.51.100.7' }) })
    })
    expect(elsewhere).toEqual({ state: 'fail', detail: 'points to 198.51.100.7, not this server' })
  })

  it('stays unknown when Cloudflare cannot see the zone or the record is a CNAME', async () => {
    const hidden = await dnsOf({
      resolve: async () => ['104.18.1.1'],
      edgesOf: async () => ({ [NAME]: edge({ state: 'unknown', zone: null, unknownReason: 'zone not visible to the Cloudflare token' }) })
    })
    expect(hidden).toEqual({ state: 'unknown', detail: 'behind Cloudflare; could not confirm where it points (zone not visible to the Cloudflare token)' })

    const cname = await dnsOf({
      resolve: async () => ['104.18.1.1'],
      edgesOf: async () => ({ [NAME]: edge({ recordType: 'CNAME', recordContent: 'origin.example.net' }) })
    })
    expect(cname.state).toBe('unknown')
  })

  it('asks Cloudflare once for all names that need it and leaves direct names alone', async () => {
    const edgesOf = vi.fn(async () => ({}))
    const resolve = async (name: string) => (name === 'direct.example.com' ? SERVER : ['104.18.1.1'])
    await checkReadiness(['direct.example.com', 'a.example.com', 'b.example.com'], deps({ resolve, edgesOf }))
    expect(edgesOf).toHaveBeenCalledTimes(1)
    expect(edgesOf).toHaveBeenCalledWith(['a.example.com', 'b.example.com'])
  })

  it('gives no Cloudflare note for names that are not proxied or whose mode is unknown', async () => {
    expect((await checkReadiness([NAME], deps()))[0].cloudflare).toBeNull()
    const noMode = await checkReadiness([NAME], deps({ resolve: async () => ['104.18.1.1'], edgesOf: async () => ({ [NAME]: edge({ sslMode: null }) }) }))
    expect(noMode[0].cloudflare).toBeNull()
  })
})

describe('checkReadiness port 80', () => {
  it('makes one plain request to the challenge path with a 5 second limit', async () => {
    const httpGet = vi.fn(answers(404))
    await checkReadiness([NAME], deps({ httpGet }))
    expect(httpGet).toHaveBeenCalledTimes(1)
    expect(httpGet).toHaveBeenCalledWith('http://app.example.com/.well-known/acme-challenge/shellway-check', 5000)
  })

  it.each([200, 301, 403, 404])('is ok when the server answers %i', async (status) => {
    expect(await port80Of({ httpGet: answers(status) })).toEqual({ state: 'ok', detail: 'answers on port 80' })
  })

  it.each([520, 521, 522, 523, 524, 525, 526])('fails with the Cloudflare code %i', async (status) => {
    expect(await port80Of({ httpGet: answers(status) })).toEqual({ state: 'fail', detail: `Cloudflare cannot reach the server on port 80 (${status})` })
  })

  it('fails when the connection is refused and when nothing answers in time', async () => {
    expect(await port80Of({ httpGet: failing('ECONNREFUSED') })).toEqual({ state: 'fail', detail: 'port 80 refused the connection' })
    expect(await port80Of({ httpGet: failing('ETIMEDOUT') })).toEqual({ state: 'fail', detail: 'no answer on port 80 within 5 seconds' })
  })

  it('stays unknown for other server errors and other failures, with the reason', async () => {
    expect(await port80Of({ httpGet: answers(502) })).toEqual({ state: 'unknown', detail: 'port 80 answered with status 502' })
    expect(await port80Of({ httpGet: failing('ECONNRESET', 'socket hang up') })).toEqual({ state: 'unknown', detail: 'socket hang up' })
  })
})

describe('checkReadiness', () => {
  it('checks every name and keeps their order', async () => {
    const result = await checkReadiness(['a.example.com', 'b.example.com'], deps({ resolve: async (name) => (name === 'a.example.com' ? SERVER : ['198.51.100.7']) }))
    expect(result.map((r) => [r.name, r.dns.state])).toEqual([['a.example.com', 'ok'], ['b.example.com', 'fail']])
  })
})
