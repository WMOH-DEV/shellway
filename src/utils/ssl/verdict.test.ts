import { describe, it, expect } from 'vitest'
import type { EdgeInfo, OriginCert } from '@/types/ssl'
import { certCovers, daysLeft, verdictFor, VERDICT_ORDER, type VerdictInput } from './verdict'

const DAY = 86_400
const NOW = 1_800_000_000

const cert = (overrides: Partial<OriginCert> = {}): OriginCert => ({
  kind: 'letsencrypt',
  subject: 'CN=app.example.com',
  issuer: "C=US, O=Let's Encrypt, CN=R11",
  names: ['app.example.com'],
  notBefore: NOW - 30 * DAY,
  notAfter: NOW + 60 * DAY,
  error: null,
  ...overrides
})

const edge = (overrides: Partial<EdgeInfo> = {}): EdgeInfo => ({
  state: 'proxied', zone: 'example.com', recordType: 'A', recordContent: '203.0.113.10', sslMode: 'strict', unknownReason: null, ...overrides
})

const input = (overrides: Partial<VerdictInput> = {}): VerdictInput => ({
  host: 'app.example.com', origin: cert(), edge: edge(), certbotManaged: true, renewalHealthy: true, now: NOW, ...overrides
})

describe('verdictFor', () => {
  it.each<[string, Partial<VerdictInput>, string, string]>([
    ['strict and expired', { origin: cert({ notAfter: NOW - DAY }) }, 'broken', 'Visitors get error 526'],
    ['strict and self-signed', { origin: cert({ kind: 'self-signed' }) }, 'broken', 'Visitors get error 526'],
    ['strict and a name mismatch', { origin: cert({ names: ['other.example.com'] }) }, 'broken', 'Visitors get error 526'],
    ['full with no certificate', { origin: cert({ kind: 'none', notAfter: null, names: [] }), edge: edge({ sslMode: 'full' }) }, 'broken', 'Cloudflare cannot reach the server over HTTPS'],
    ['origin CA without the orange cloud', { origin: cert({ kind: 'cloudflare-origin' }), edge: edge({ state: 'dns-only', sslMode: null }) }, 'broken', 'Visitors get a certificate error'],
    ['direct visitors and an expired certificate', { origin: cert({ notAfter: NOW - DAY }), edge: edge({ state: 'not-on-cloudflare', zone: null, sslMode: null }) }, 'broken', 'Visitors get a certificate error'],
    ['soon and renewal broken', { origin: cert({ notAfter: NOW + 6 * DAY }), renewalHealthy: false }, 'will-break', 'Expires in 6 days and renewal is not working'],
    ['soon and not managed by certbot', { origin: cert({ kind: 'other', notAfter: NOW + 3 * DAY }), certbotManaged: false }, 'will-break', 'Expires in 3 days and nothing renews it'],
    ['soon with healthy renewal', { origin: cert({ notAfter: NOW + 10 * DAY }) }, 'expiring', 'certbot should have renewed at 30 days left'],
    ['no certificate and not behind Cloudflare', { origin: cert({ kind: 'none', notAfter: null, names: [] }), edge: edge({ state: 'dns-only', sslMode: null }) }, 'not-encrypted', 'No HTTPS certificate on the server'],
    ['no certificate and an unknown edge', { origin: cert({ kind: 'none', notAfter: null, names: [] }), edge: edge({ state: 'unknown', sslMode: null, unknownReason: 'no token' }) }, 'not-encrypted', 'No HTTPS certificate on the server'],
    ['flexible mode', { edge: edge({ sslMode: 'flexible' }) }, 'not-encrypted', 'Cloudflare reaches the server over plain HTTP'],
    ['zone not visible', { edge: edge({ state: 'unknown', sslMode: null, unknownReason: 'zone not visible to the token' }) }, 'unchecked', 'Cloudflare side: zone not visible to the token'],
    ['server side unreadable', { origin: null }, 'unchecked', 'Server side: not checked'],
    ['healthy', {}, 'ok', "Let's Encrypt · 60 days left"]
  ])('%s', (_label, overrides, verdict, reason) => {
    expect(verdictFor(input(overrides))).toMatchObject({ verdict, reason })
  })

  it('names the side that could not be checked', () => {
    expect(verdictFor(input({ origin: null })).uncheckedSide).toBe('server')
    expect(verdictFor(input({ edge: edge({ state: 'unknown', unknownReason: 'no token' }) })).uncheckedSide).toBe('cloudflare')
    expect(verdictFor(input()).uncheckedSide).toBeNull()
  })

  it('keeps an expired certificate behind an unknown edge out of the OK bucket', () => {
    const result = verdictFor(input({ origin: cert({ notAfter: NOW - 2 * DAY }), edge: edge({ state: 'unknown', sslMode: null, unknownReason: 'no token' }) }))
    expect(result).toMatchObject({ verdict: 'expiring', reason: 'Expired 2 days ago' })
  })

  it('accepts full mode with a self-signed certificate', () => {
    expect(verdictFor(input({ origin: cert({ kind: 'self-signed' }), edge: edge({ sslMode: 'full' }) })).verdict).toBe('ok')
  })

  it('reports the origin CA renewal as not needed', () => {
    const result = verdictFor(input({ origin: cert({ kind: 'cloudflare-origin', notAfter: NOW + 4000 * DAY }), certbotManaged: false }))
    expect(result).toMatchObject({ verdict: 'ok', reason: 'Cloudflare Origin CA · 4000 days left' })
  })

  it('orders verdicts from worst to best', () => {
    expect(VERDICT_ORDER).toEqual(['broken', 'will-break', 'expiring', 'not-encrypted', 'unchecked', 'ok'])
  })
})

describe('certCovers', () => {
  it('matches exact names and single-label wildcards, case-insensitively', () => {
    expect(certCovers(['App.Example.com'], 'app.example.com')).toBe(true)
    expect(certCovers(['*.example.com'], 'app.example.com')).toBe(true)
    expect(certCovers(['*.example.com'], 'a.b.example.com')).toBe(false)
    expect(certCovers(['*.example.com'], 'example.com')).toBe(false)
  })
})

describe('daysLeft', () => {
  it('rounds down and goes negative once expired', () => {
    expect(daysLeft(NOW + 6 * DAY + 100, NOW)).toBe(6)
    expect(daysLeft(NOW - DAY, NOW)).toBe(-1)
  })
})
