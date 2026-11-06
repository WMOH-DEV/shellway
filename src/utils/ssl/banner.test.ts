import { describe, expect, it } from 'vitest'
import { criticalBanner } from './banner'
import { edgeOf, makeHost, makeOrigin, NOW, originExpiringIn } from './testReport'

const broken = makeHost({ name: 'shop.example.com', verdict: 'broken', reason: 'Visitors get error 526', origin: originExpiringIn(-2, { names: ['shop.example.com'] }) })
const willBreak = makeHost({ name: 'api.example.com', verdict: 'will-break', reason: 'Expires in 6 days and renewal is not working', origin: originExpiringIn(6) })

describe('criticalBanner', () => {
  it('is null when nothing is broken or about to break', () => {
    expect(criticalBanner([makeHost({ verdict: 'expiring' }), makeHost({ verdict: 'ok' })], NOW)).toBeNull()
    expect(criticalBanner([], NOW)).toBeNull()
  })

  it('names the worst host, the visitor impact and the next one', () => {
    expect(criticalBanner([broken, willBreak], NOW)).toEqual({
      host: 'shop.example.com',
      title: 'shop.example.com is down for visitors (error 526).',
      detail: "The server's certificate expired 2 days ago. api.example.com follows in 6 days."
    })
  })

  it('describes a will-break host in days', () => {
    expect(criticalBanner([willBreak], NOW)).toMatchObject({
      title: 'api.example.com will stop working for visitors in 6 days.',
      detail: 'Expires in 6 days and renewal is not working.'
    })
  })

  it('explains a certificate error for a direct host with an Origin CA certificate', () => {
    const host = makeHost({
      name: 'mail.example.com',
      verdict: 'broken',
      reason: 'Visitors get a certificate error',
      edge: edgeOf({ state: 'dns-only' }),
      origin: makeOrigin({ kind: 'cloudflare-origin', names: ['mail.example.com'], notAfter: NOW + 3000 * 86_400 })
    })
    expect(criticalBanner([host], NOW)).toMatchObject({
      title: 'mail.example.com shows visitors a certificate error.',
      detail: 'A Cloudflare Origin CA certificate only works behind the orange cloud.'
    })
  })

  it('reports a second broken host without a day count', () => {
    const other = makeHost({ name: 'blog.example.com', verdict: 'broken', reason: 'Cloudflare cannot reach the server over HTTPS', origin: makeOrigin({ kind: 'none' }) })
    expect(criticalBanner([broken, other], NOW)?.detail).toContain('blog.example.com is also broken.')
  })
})
