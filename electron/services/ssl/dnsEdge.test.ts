import { describe, expect, it, vi } from 'vitest'
import { edgesWithoutZone, isCloudflareAddress } from './dnsEdge'

const REASON = 'zone not visible to the Cloudflare token'
const SERVER = ['203.0.113.10']

const resolverFor = (table: Record<string, string[] | Error>) =>
  vi.fn(async (host: string) => {
    const entry = table[host]
    if (entry instanceof Error) throw entry
    return entry ?? []
  })

const dnsError = (code: string) => Object.assign(new Error(code), { code })

describe('isCloudflareAddress', () => {
  it('recognises addresses inside the published ranges', () => {
    expect(isCloudflareAddress('104.16.0.1')).toBe(true)
    expect(isCloudflareAddress('172.67.10.20')).toBe(true)
    expect(isCloudflareAddress('2606:4700::6810:1')).toBe(true)
  })

  it('rejects addresses outside the ranges', () => {
    expect(isCloudflareAddress('203.0.113.10')).toBe(false)
    expect(isCloudflareAddress('198.51.100.7')).toBe(false)
    expect(isCloudflareAddress('2001:db8::1')).toBe(false)
  })
})

describe('edgesWithoutZone', () => {
  it('reports unknown with the given reason when the name points at Cloudflare', async () => {
    const resolve = resolverFor({ 'app.example.net': ['104.18.1.1'] })
    const edges = await edgesWithoutZone(['app.example.net'], SERVER, REASON, resolve)
    expect(edges['app.example.net']).toMatchObject({ state: 'unknown', unknownReason: REASON, zone: null })
  })

  it('treats a mix with one Cloudflare address as on Cloudflare', async () => {
    const resolve = resolverFor({ 'app.example.net': ['203.0.113.10', '2606:4700::1'] })
    const edges = await edgesWithoutZone(['app.example.net'], SERVER, REASON, resolve)
    expect(edges['app.example.net'].state).toBe('unknown')
  })

  it('reports elsewhere when the addresses are not this server', async () => {
    const resolve = resolverFor({ 'app.example.net': ['198.51.100.7'] })
    const edges = await edgesWithoutZone(['app.example.net'], SERVER, REASON, resolve)
    expect(edges['app.example.net']).toMatchObject({ state: 'elsewhere', recordType: 'A', recordContent: '198.51.100.7' })
  })

  it('reports not-on-cloudflare when the name points at this server', async () => {
    const resolve = resolverFor({ 'app.example.net': ['203.0.113.10'] })
    const edges = await edgesWithoutZone(['app.example.net'], SERVER, REASON, resolve)
    expect(edges['app.example.net']).toMatchObject({ state: 'not-on-cloudflare', recordContent: '203.0.113.10' })
  })

  it('does not call it elsewhere when the server addresses are unknown', async () => {
    const resolve = resolverFor({ 'app.example.net': ['198.51.100.7'] })
    const edges = await edgesWithoutZone(['app.example.net'], [], REASON, resolve)
    expect(edges['app.example.net'].state).toBe('not-on-cloudflare')
  })

  it('compares IPv6 addresses ignoring case', async () => {
    const resolve = resolverFor({ 'app.example.net': ['2001:DB8::10'] })
    const edges = await edgesWithoutZone(['app.example.net'], ['2001:db8::10'], REASON, resolve)
    expect(edges['app.example.net']).toMatchObject({ state: 'not-on-cloudflare', recordType: 'AAAA' })
  })

  it('says so plainly when the name does not resolve', async () => {
    const resolve = resolverFor({ 'gone.example.net': dnsError('ENOTFOUND') })
    const edges = await edgesWithoutZone(['gone.example.net'], SERVER, REASON, resolve)
    expect(edges['gone.example.net']).toMatchObject({ state: 'unknown', unknownReason: 'no DNS address found for this name', noRecord: true })
  })

  it('names the error code for other lookup failures', async () => {
    const resolve = resolverFor({ 'slow.example.net': dnsError('ETIMEOUT') })
    const edges = await edgesWithoutZone(['slow.example.net'], SERVER, REASON, resolve)
    expect(edges['slow.example.net']).toMatchObject({ unknownReason: 'DNS lookup failed (ETIMEOUT)' })
    expect(edges['slow.example.net'].noRecord).toBeUndefined()
  })

  it('treats an empty answer as no address', async () => {
    const edges = await edgesWithoutZone(['empty.example.net'], SERVER, REASON, resolverFor({}))
    expect(edges['empty.example.net']).toMatchObject({ unknownReason: 'no DNS address found for this name', noRecord: true })
  })

  it('looks each host up exactly once', async () => {
    const resolve = resolverFor({ 'a.example.net': ['203.0.113.10'], 'b.example.net': dnsError('ETIMEOUT') })
    const edges = await edgesWithoutZone(['a.example.net', 'b.example.net'], SERVER, REASON, resolve)
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(Object.keys(edges)).toEqual(['a.example.net', 'b.example.net'])
  })
})
