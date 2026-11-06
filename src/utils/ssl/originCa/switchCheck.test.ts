import { describe, expect, it } from 'vitest'
import type { SslReport } from '../../../types/ssl'
import { connectedCloudflare, edgeOf, makeBlock, makeFacts, makeHost, makeOrigin, makeReport, unknownEdge } from '../testReport'
import { switchCheck } from './switchCheck'

const ready = (overrides: Partial<SslReport> = {}): SslReport => makeReport({
  facts: makeFacts({ sudo: { certbot: true, nginx: true, full: true } }),
  blocks: [makeBlock({ names: ['app.example.com', 'www.example.com'] })],
  hostnames: [makeHost(), makeHost({ name: 'www.example.com' })],
  cloudflare: { ...connectedCloudflare, permissions: [...connectedCloudflare.permissions, { id: 'origin-ca', state: 'granted', lines: [] }] },
  ...overrides
})

describe('switchCheck', () => {
  it('allows the switch when every name in the block is proxied and the token and sudo allow it', () => {
    expect(switchCheck(ready(), 'app.conf:9')).toEqual({
      blockId: 'app.conf:9',
      names: [{ name: 'app.example.com', ok: true, reason: null }, { name: 'www.example.com', ok: true, reason: null }],
      blockedReason: null
    })
  })

  it('allows the switch when the token can read certificates but Edit cannot be confirmed without trying', () => {
    const unconfirmed = { ...connectedCloudflare, permissions: [{ id: 'origin-ca' as const, state: 'unknown' as const, lines: [] }] }
    expect(switchCheck(ready({ cloudflare: unconfirmed }), 'app.conf:9').blockedReason).toBeNull()
  })

  it('lists the names that would break', () => {
    const report = ready({ hostnames: [makeHost(), makeHost({ name: 'www.example.com', edge: edgeOf({ state: 'dns-only' }) })] })
    const check = switchCheck(report, 'app.conf:9')
    expect(check.names[1]).toEqual({ name: 'www.example.com', ok: false, reason: 'not proxied by Cloudflare' })
    expect(check.blockedReason).toBe('These names would break: www.example.com')
    expect(switchCheck(ready({ hostnames: [makeHost(), makeHost({ name: 'www.example.com', edge: unknownEdge })] }), 'app.conf:9').names[1].reason).toBe('zone not visible to the token')
  })

  it('refuses wildcard names and names that were never checked', () => {
    const report = ready({ blocks: [makeBlock({ names: ['app.example.com', '*.example.com', 'new.example.com'] })] })
    expect(switchCheck(report, 'app.conf:9').names.map((n) => n.reason)).toEqual([null, 'wildcard and pattern names are not supported', 'not checked yet'])
  })

  it('explains each missing precondition in order', () => {
    expect(switchCheck(ready(), 'gone.conf:1').blockedReason).toBe('This site is no longer in the nginx configuration.')
    expect(switchCheck(ready({ blocks: [makeBlock({ tls: false, certPath: '' })] }), 'app.conf:9').blockedReason).toBe('This site has no HTTPS server block to switch.')
    expect(switchCheck(ready({ cloudflare: { ...connectedCloudflare, saved: false } }), 'app.conf:9').blockedReason).toBe('Add a Cloudflare token first.')
    expect(switchCheck(ready({ cloudflare: connectedCloudflare }), 'app.conf:9').blockedReason).toBe('The Cloudflare token needs SSL and Certificates · Edit.')
    const notGranted = { ...connectedCloudflare, permissions: [{ id: 'origin-ca' as const, state: 'not-granted' as const, lines: [] }] }
    expect(switchCheck(ready({ cloudflare: notGranted }), 'app.conf:9').blockedReason).toBe('The Cloudflare token needs SSL and Certificates · Edit.')
    expect(switchCheck(ready({ facts: makeFacts() }), 'app.conf:9').blockedReason).toBe('Needs full passwordless sudo on this server.')
  })

  it('says when the site already uses an Origin CA certificate', () => {
    const origin = makeOrigin({ kind: 'cloudflare-origin' })
    const report = ready({ hostnames: [makeHost({ origin }), makeHost({ name: 'www.example.com', origin })] })
    expect(switchCheck(report, 'app.conf:9').blockedReason).toBe('This site already uses a Cloudflare Origin CA certificate.')
  })
})
