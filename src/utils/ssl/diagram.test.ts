import { describe, expect, it } from 'vitest'
import { diagramView, issuerLabel } from './diagram'
import { formatDay } from './time'
import { DAY, edgeOf, makeFacts, makeHost, makeOrigin, NOW, originExpiringIn, unknownEdge } from './testReport'

const failedRenewal = makeFacts({ renewal: { mechanism: 'certbot.timer', lastRun: NOW - 4 * DAY, lastResult: 'failed', output: '' } })

describe('diagramView with Cloudflare in front', () => {
  it('shows a healthy proxied host as two solid connectors', () => {
    const view = diagramView(makeHost(), makeFacts(), NOW)
    expect(view.cloudflare).toMatchObject({ tone: 'success', chip: 'OK', sentence: 'Cloudflare shows visitors its own certificate. It renews it automatically.' })
    expect(view.cloudflare?.detail).toBe('Proxied · SSL mode Full (strict) · zone example.com')
    expect(view.server).toMatchObject({ tone: 'success', chip: 'OK' })
    expect(view.visitorLeg).toEqual({ tone: 'success', failing: false, protocol: 'HTTPS', label: 'browser checks' })
    expect(view.originLeg).toEqual({ tone: 'success', failing: false, protocol: 'HTTPS', label: 'Cloudflare checks' })
  })

  it('fails only the Cloudflare to server leg when the server certificate is about to expire', () => {
    const host = makeHost({ verdict: 'will-break', origin: originExpiringIn(6) })
    const view = diagramView(host, failedRenewal, NOW)
    expect(view.visitorLeg.failing).toBe(false)
    expect(view.originLeg).toMatchObject({ tone: 'error', failing: true, label: 'Cloudflare checks' })
    expect(view.server).toMatchObject({ tone: 'error', chip: '6 days left' })
    expect(view.server.sentence).toBe(`Your server's certificate expires on ${formatDay(NOW + 6 * DAY, true)}. certbot's renewal last failed on ${formatDay(NOW - 4 * DAY)}.`)
    expect(view.server.detail).toBe('When it expires, visitors get error 526.')
  })

  it('reports an expired certificate with the reason from the verdict', () => {
    const host = makeHost({ verdict: 'broken', reason: 'Visitors get error 526', origin: originExpiringIn(-2) })
    const view = diagramView(host, makeFacts(), NOW)
    expect(view.server).toMatchObject({ tone: 'error', chip: 'Expired', detail: 'Visitors get error 526.' })
    expect(view.originLeg?.failing).toBe(true)
  })

  it('shows plain HTTP to the server in flexible mode without a failing leg', () => {
    const host = makeHost({ verdict: 'not-encrypted', edge: edgeOf({ sslMode: 'flexible' }), origin: makeOrigin({ kind: 'none', notAfter: null, notBefore: null }) })
    const view = diagramView(host, makeFacts(), NOW)
    expect(view.originLeg).toEqual({ tone: 'warning', failing: false, protocol: 'HTTP', label: 'Cloudflare checks' })
    expect(view.server).toMatchObject({ tone: 'warning', chip: 'No certificate' })
    expect(view.server.sentence).toContain('plain HTTP')
  })

  it('marks a valid certificate as not used in flexible mode', () => {
    const host = makeHost({ verdict: 'not-encrypted', edge: edgeOf({ sslMode: 'flexible' }) })
    expect(diagramView(host, makeFacts(), NOW).server).toMatchObject({ tone: 'warning', chip: 'Not used' })
  })

  it('says nothing renews a near expiry certificate that certbot does not manage', () => {
    const host = makeHost({ verdict: 'will-break', lineage: null, origin: originExpiringIn(5) })
    expect(diagramView(host, makeFacts(), NOW).server.sentence).toMatch(/Nothing renews it\.$/)
  })

  it('flags a name the certificate does not cover', () => {
    const host = makeHost({ verdict: 'broken', reason: 'Visitors get error 526', origin: originExpiringIn(60, { names: ['other.example.com'] }) })
    expect(diagramView(host, makeFacts(), NOW).server).toMatchObject({ chip: 'Wrong name', tone: 'error' })
  })

  it('describes Origin CA certificates as not needing renewal', () => {
    const origin = makeOrigin({ kind: 'cloudflare-origin', issuer: 'CloudFlare, Inc. · CloudFlare Origin SSL Certificate Authority', notBefore: NOW, notAfter: NOW + 5000 * DAY })
    expect(diagramView(makeHost({ origin, lineage: null }), makeFacts(), NOW).server.sentence).toContain('It does not need renewing.')
  })
})

describe('diagramView without Cloudflare', () => {
  it('collapses to one connector for DNS only', () => {
    const view = diagramView(makeHost({ edge: edgeOf({ state: 'dns-only' }) }), makeFacts(), NOW)
    expect(view.cloudflare).toBeNull()
    expect(view.originLeg).toBeNull()
    expect(view.visitorLeg).toMatchObject({ label: 'browser checks', failing: false })
    expect(view.server.detail).toContain('visitors connect straight to your server')
  })

  it('makes the single connector fail when the server certificate fails', () => {
    const host = makeHost({ edge: edgeOf({ state: 'not-on-cloudflare' }), verdict: 'broken', reason: 'Visitors get a certificate error', origin: originExpiringIn(-1) })
    expect(diagramView(host, makeFacts(), NOW).visitorLeg).toMatchObject({ tone: 'error', failing: true })
  })

  it('notes when DNS points to another server', () => {
    expect(diagramView(makeHost({ edge: edgeOf({ state: 'elsewhere' }) }), makeFacts(), NOW).server.detail).toContain('another server')
  })
})

describe('diagramView with Cloudflare unknown', () => {
  it('uses a neutral Cloudflare card with the reason and neutral connectors', () => {
    const view = diagramView(makeHost({ edge: unknownEdge, verdict: 'unchecked', uncheckedSide: 'cloudflare' }), makeFacts(), NOW)
    expect(view.cloudflare).toMatchObject({ tone: 'neutral', chip: 'Not checked' })
    expect(view.cloudflare?.sentence).toContain('zone not visible to the token')
    expect(view.visitorLeg.tone).toBe('neutral')
    expect(view.originLeg).toMatchObject({ tone: 'neutral', failing: false })
  })
})

describe('server card when the server side was not read', () => {
  it('is neutral and repeats the verdict reason', () => {
    const host = makeHost({ origin: null, wildcard: true, verdict: 'unchecked', uncheckedSide: 'server', reason: 'Wildcard name, not checked' })
    expect(diagramView(host, makeFacts(), NOW).server).toMatchObject({ tone: 'neutral', chip: 'Not checked', detail: 'Wildcard name, not checked' })
  })
})

describe('issuerLabel', () => {
  it('shows the issuer as the server scan named it, or the kind when it has none', () => {
    expect(issuerLabel(makeOrigin())).toBe("Let's Encrypt · E6")
    expect(issuerLabel(makeOrigin({ kind: 'self-signed', issuer: '' }))).toBe('Self-signed')
  })
})
