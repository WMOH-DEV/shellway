import { describe, expect, it } from 'vitest'
import type { Verdict } from '../../types/ssl'
import {
  certView, edgeView, filterCounts, groupByBlock, isRenewalHealthy, lifeRatio, matchesFilter, renewalView, verdictBadge, verdictHeadline
} from './hostRow'
import { formatDay } from './time'
import { DAY, edgeOf, makeFacts, makeHost, makeOrigin, NOW, originExpiringIn, unknownEdge } from './testReport'

const verdicts: Verdict[] = ['broken', 'will-break', 'expiring', 'not-encrypted', 'unchecked', 'no-dns', 'ok']

describe('filters', () => {
  const hosts = [
    makeHost({ name: 'a.example.com', verdict: 'broken' }),
    makeHost({ name: 'b.example.com', verdict: 'ok', edge: edgeOf({ state: 'dns-only' }), lineage: null }),
    makeHost({ name: 'c.example.com', verdict: 'unchecked', edge: unknownEdge })
  ]

  it('needs action covers the four problem verdicts and not unchecked, not in DNS or ok', () => {
    const flagged = verdicts.filter((verdict) => matchesFilter(makeHost({ verdict }), 'attention'))
    expect(flagged).toEqual(['broken', 'will-break', 'expiring', 'not-encrypted'])
  })

  it('counts each filter', () => {
    expect(filterCounts(hosts)).toEqual({ all: 3, attention: 1, cloudflare: 1, certbot: 2 })
  })

  it('behind Cloudflare means proxied only', () => {
    expect(matchesFilter(hosts[1], 'cloudflare')).toBe(false)
    expect(matchesFilter(hosts[0], 'cloudflare')).toBe(true)
  })
})

describe('groupByBlock', () => {
  it('groups names sharing a server block, ordered by first appearance', () => {
    const hosts = [
      makeHost({ name: 'a.example.com', blockId: 'x:1' }),
      makeHost({ name: 'b.example.com', blockId: 'y:1' }),
      makeHost({ name: 'www.a.example.com', blockId: 'x:1' })
    ]
    expect(groupByBlock(hosts).map((g) => g.map((h) => h.name))).toEqual([['a.example.com', 'www.a.example.com'], ['b.example.com']])
  })
})

describe('verdict labels', () => {
  it('maps verdicts to badge label and tone', () => {
    expect(verdictBadge(makeHost({ verdict: 'broken' }))).toEqual({ label: 'Broken now', tone: 'error' })
    expect(verdictBadge(makeHost({ verdict: 'expiring' }))).toEqual({ label: 'Expiring soon', tone: 'warning' })
    expect(verdictBadge(makeHost({ verdict: 'not-encrypted' }))).toEqual({ label: 'Not encrypted to server', tone: 'warning' })
    expect(verdictBadge(makeHost({ verdict: 'unchecked' }))).toEqual({ label: 'Unchecked side', tone: 'neutral' })
    expect(verdictBadge(makeHost({ verdict: 'ok' }))).toEqual({ label: 'OK', tone: 'success' })
  })

  it('puts the key fact in the detail headline', () => {
    const willBreak = makeHost({ verdict: 'will-break', origin: originExpiringIn(6) })
    expect(verdictHeadline(willBreak, NOW)).toEqual({ label: 'Will break in 6 days', tone: 'error' })
    expect(verdictHeadline(makeHost({ verdict: 'expiring', origin: originExpiringIn(1) }), NOW).label).toBe('Expiring in 1 day')
    expect(verdictHeadline(makeHost({ verdict: 'expiring', origin: originExpiringIn(-3) }), NOW).label).toBe('Expired 3 days ago')
  })

  it('names the unchecked side', () => {
    const host = makeHost({ verdict: 'unchecked', uncheckedSide: 'cloudflare', edge: unknownEdge })
    expect(verdictHeadline(host, NOW).label).toBe('Cloudflare side not checked')
    expect(verdictHeadline(makeHost({ verdict: 'unchecked', uncheckedSide: 'server', origin: null }), NOW).label).toBe('Server side not checked')
  })

  it('falls back to the plain label for broken and ok', () => {
    expect(verdictHeadline(makeHost({ verdict: 'broken' }), NOW).label).toBe('Broken now')
    expect(verdictHeadline(makeHost({ verdict: 'ok' }), NOW).label).toBe('OK')
  })
})

describe('lifeRatio', () => {
  it('is remaining over total lifetime', () => {
    expect(lifeRatio(NOW - 60 * DAY, NOW + 30 * DAY, NOW)).toBeCloseTo(1 / 3)
  })

  it('clamps to 0 when expired and 1 when not yet valid', () => {
    expect(lifeRatio(NOW - 90 * DAY, NOW - DAY, NOW)).toBe(0)
    expect(lifeRatio(NOW + DAY, NOW + 90 * DAY, NOW)).toBe(1)
  })

  it('is 0 without dates', () => {
    expect(lifeRatio(null, NOW + DAY, NOW)).toBe(0)
    expect(lifeRatio(NOW, null, NOW)).toBe(0)
  })
})

describe('certView', () => {
  it('colors by how close expiry is', () => {
    expect(certView(makeHost({ origin: originExpiringIn(52) }), NOW).tone).toBe('success')
    expect(certView(makeHost({ origin: originExpiringIn(11), verdict: 'expiring' }), NOW)).toMatchObject({ tone: 'warning', daysText: '11 days left' })
    expect(certView(makeHost({ origin: originExpiringIn(6), verdict: 'will-break' }), NOW).tone).toBe('error')
  })

  it('says how long ago an expired certificate ended', () => {
    expect(certView(makeHost({ origin: originExpiringIn(-2), verdict: 'broken' }), NOW)).toMatchObject({ daysText: 'expired 2 days ago', tone: 'error', life: 0 })
  })

  it('shows the year for long lived Origin CA certificates', () => {
    const origin = makeOrigin({ kind: 'cloudflare-origin', notBefore: NOW, notAfter: NOW + 5000 * DAY })
    expect(certView(makeHost({ origin }), NOW)).toMatchObject({ kindLabel: 'Cloudflare Origin CA', daysText: `until ${new Date((NOW + 5000 * DAY) * 1000).getFullYear()}` })
  })

  it('is neutral without a certificate or when not checked', () => {
    expect(certView(makeHost({ origin: makeOrigin({ kind: 'none', notAfter: null, notBefore: null }) }), NOW)).toMatchObject({ kindLabel: 'No certificate', daysText: '—', tone: 'neutral' })
    expect(certView(makeHost({ origin: null }), NOW)).toMatchObject({ kindLabel: 'Not checked', tone: 'neutral' })
  })
})

describe('edgeView', () => {
  it('describes each Cloudflare state with a second line', () => {
    expect(edgeView(edgeOf({ sslMode: 'strict' }))).toEqual({ label: 'Proxied', detail: 'Full (strict)', proxied: true })
    expect(edgeView(edgeOf({ state: 'dns-only' }))).toEqual({ label: 'DNS only', detail: 'not proxied', proxied: false })
    expect(edgeView(edgeOf({ state: 'not-on-cloudflare' }))).toMatchObject({ label: 'Not on Cloudflare' })
    expect(edgeView(edgeOf({ state: 'elsewhere', recordContent: '198.51.100.7' }))).toMatchObject({ label: 'Points to another server', detail: 'record points to 198.51.100.7' })
  })

  it('shows why Cloudflare is unknown', () => {
    expect(edgeView(unknownEdge)).toEqual({ label: 'Unknown', detail: 'Zone not visible to the token', proxied: false })
  })
})

describe('renewalView', () => {
  const failed = makeFacts({ renewal: { mechanism: 'certbot.timer', lastRun: NOW - 5 * DAY, lastResult: 'failed', output: '' } })

  it('shows the timer and a successful last run', () => {
    expect(renewalView(makeHost(), makeFacts(), NOW)).toEqual({ title: 'certbot.timer', sub: 'last run ok · 9 h ago', tone: 'success' })
  })

  it('flags a failed last run with its date', () => {
    expect(renewalView(makeHost(), failed, NOW)).toEqual({ title: 'certbot.timer failed', sub: `last run ${formatDay(NOW - 5 * DAY)}`, tone: 'error' })
  })

  it('says nothing renews when there is no mechanism', () => {
    const none = makeFacts({ renewal: { mechanism: 'none', lastRun: null, lastResult: 'unknown', output: '' } })
    expect(renewalView(makeHost(), none, NOW)).toMatchObject({ title: 'No automatic renewal', tone: 'warning' })
  })

  it('needs no renewal for Origin CA certificates', () => {
    const origin = makeOrigin({ kind: 'cloudflare-origin', notAfter: NOW + 5000 * DAY })
    expect(renewalView(makeHost({ origin, lineage: null }), makeFacts(), NOW)).toEqual({ title: 'Not needed', sub: `valid until ${formatDay(NOW + 5000 * DAY, true)}`, tone: 'success' })
  })

  it('is a dash when certbot does not manage the name', () => {
    expect(renewalView(makeHost({ lineage: null }), makeFacts(), NOW)).toEqual({ title: '—', sub: '', tone: 'neutral' })
  })

  it('treats a failed run or no timer as unhealthy', () => {
    expect(isRenewalHealthy(makeFacts())).toBe(true)
    expect(isRenewalHealthy(failed)).toBe(false)
    expect(isRenewalHealthy(makeFacts({ renewal: { mechanism: 'none', lastRun: null, lastResult: 'unknown', output: '' } }))).toBe(false)
  })
})
