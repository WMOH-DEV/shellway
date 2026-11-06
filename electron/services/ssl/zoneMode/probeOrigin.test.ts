import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer as createNetServer, type Server as NetServer } from 'node:net'
import { join } from 'node:path'
import { createServer, type Server } from 'node:tls'
import { afterEach, describe, expect, it } from 'vitest'
import { ORIGIN_CA_ECC_ROOT, ORIGIN_CA_RSA_ROOT } from './originCaRoots'
import { probeOrigin, trustedRoots, UNREACHABLE_DETAIL } from './probeOrigin'

const fixture = (file: string) => readFileSync(join(__dirname, 'fixtures', file), 'utf8')
const TEST_CA = fixture('test-ca.pem')
const NAME = 'app.example.com'

const servers: (Server | NetServer)[] = []

async function listen(server: Server | NetServer): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return typeof address === 'object' && address ? address.port : 0
}

const serve = (name: string) => listen(createServer({ cert: fixture(`${name}.pem`), key: fixture(`${name}.key`) }, (socket) => socket.end()))

const target = (name = NAME) => ({ name, recordType: 'A', origin: '127.0.0.1' })

afterEach(() => {
  while (servers.length > 0) servers.pop()?.close()
})

describe('probeOrigin', () => {
  it('passes a certificate signed by a root we trust that covers the name', async () => {
    const port = await serve('leaf')
    const outcome = await probeOrigin(target(), { port, extraRoots: [TEST_CA] })
    expect(outcome.state).toBe('pass')
  })

  it('fails a certificate from an authority nobody trusts', async () => {
    const port = await serve('leaf')
    const outcome = await probeOrigin(target(), { port })
    expect(outcome).toEqual({ state: 'fail', detail: "the origin certificate was issued by an authority Cloudflare doesn't trust" })
  })

  it('fails a self-signed certificate', async () => {
    const port = await serve('selfsigned')
    const outcome = await probeOrigin(target(), { port })
    expect(outcome).toEqual({ state: 'fail', detail: 'the origin certificate is self-signed' })
  })

  it('fails a certificate that does not cover the hostname', async () => {
    const port = await serve('leaf')
    const outcome = await probeOrigin(target('other.example.com'), { port, extraRoots: [TEST_CA] })
    expect(outcome).toEqual({ state: 'fail', detail: 'the origin certificate does not cover other.example.com' })
  })

  it('fails an expired certificate', async () => {
    const port = await serve('expired')
    const outcome = await probeOrigin(target(), { port, extraRoots: [TEST_CA] })
    expect(outcome).toEqual({ state: 'fail', detail: 'the origin certificate has expired' })
  })

  it('fails when the port does not speak TLS', async () => {
    const port = await listen(createNetServer((socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')))
    const outcome = await probeOrigin(target(), { port })
    expect(outcome.state).toBe('fail')
    expect(outcome.detail).toBe('the TLS handshake with the origin failed')
  })

  it('reports unknown when nothing listens on the port', async () => {
    const port = await listen(createNetServer())
    servers.pop()?.close()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await probeOrigin(target(), { port })).toEqual({ state: 'unknown', detail: UNREACHABLE_DETAIL })
  })

  it('reports unknown when the origin never answers', async () => {
    const port = await listen(createNetServer(() => {}))
    expect(await probeOrigin(target(), { port, timeoutMs: 100 })).toEqual({ state: 'unknown', detail: UNREACHABLE_DETAIL })
  })
})

describe('trustedRoots', () => {
  it('adds both Cloudflare Origin CA roots to the public roots', () => {
    const roots = trustedRoots([TEST_CA])
    expect(roots).toEqual(expect.arrayContaining([ORIGIN_CA_RSA_ROOT, ORIGIN_CA_ECC_ROOT, TEST_CA]))
    expect(roots.length).toBeGreaterThan(100)
  })

  it('embeds the official roots', () => {
    const rsa = new X509Certificate(ORIGIN_CA_RSA_ROOT)
    const ecc = new X509Certificate(ORIGIN_CA_ECC_ROOT)
    expect(rsa.subject).toContain('O=CloudFlare\\, Inc.')
    expect(rsa.subject).toContain('OU=CloudFlare Origin SSL Certificate Authority')
    expect(ecc.subject).toContain('OU=CloudFlare Origin SSL ECC Certificate Authority')
    expect(rsa.subject).toBe(rsa.issuer)
    expect(ecc.subject).toBe(ecc.issuer)
  })
})
