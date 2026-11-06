import { describe, expect, it, vi } from 'vitest'
import type { OriginCert, PrepFacts } from '../../../../src/types/ssl'
import { lastMeaningfulLine, verifyHttps } from './verify'
import type { VerifyDeps } from './verify'

const NAME = 'app.example.com'

const cert: OriginCert = { kind: 'letsencrypt', subject: `CN=${NAME}`, issuer: 'CN=R11', names: [NAME], notBefore: 1, notAfter: 2, error: null }

const answers = (status: number) => async () => ({ status })
const failing = (code: string, message = code) => async () => { throw Object.assign(new Error(message), { code }) }

function deps(overrides: Partial<VerifyDeps> = {}): VerifyDeps {
  return {
    names: [NAME],
    probeServer: async () => ({ [NAME]: cert }),
    httpGet: answers(200),
    renewalTest: async () => ({ code: 0, output: '' }),
    detect: async () => ({ renewalTimer: 'snap.certbot.renew.timer' }) as PrepFacts,
    ...overrides
  }
}

const httpsOf = async (overrides: Partial<VerifyDeps>) => (await verifyHttps(deps(overrides))).names[0].https

describe('verifyHttps names', () => {
  it('returns the served certificate and a passing HTTPS check, with one request per name', async () => {
    const httpGet = vi.fn(answers(200))
    const result = await verifyHttps(deps({ httpGet }))
    expect(result.names).toEqual([{ name: NAME, served: cert, https: { state: 'ok', detail: 'HTTPS works (status 200)' } }])
    expect(httpGet).toHaveBeenCalledTimes(1)
    expect(httpGet).toHaveBeenCalledWith('https://app.example.com/', 10_000)
  })

  it.each([301, 403, 404])('counts status %i as working', async (status) => {
    expect((await httpsOf({ httpGet: answers(status) })).state).toBe('ok')
  })

  it.each([
    ['CERT_HAS_EXPIRED', 'the certificate has expired'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'the certificate is for a different name'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'the certificate is self-signed'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'the certificate is self-signed'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'the certificate is not trusted'],
    ['ECONNREFUSED', 'port 443 refused the connection'],
    ['ETIMEDOUT', 'no answer on port 443 within 10 seconds']
  ])('explains %s in plain words', async (code, detail) => {
    expect(await httpsOf({ httpGet: failing(code) })).toEqual({ state: 'fail', detail })
  })

  it('shows the message of an error it does not know', async () => {
    expect(await httpsOf({ httpGet: failing('EPROTO', 'handshake failure') })).toEqual({ state: 'fail', detail: 'could not connect (handshake failure)' })
  })

  it('recognises the Cloudflare secure connection errors', async () => {
    expect(await httpsOf({ httpGet: answers(525) })).toEqual({ state: 'fail', detail: 'Cloudflare could not complete a secure connection to the server (525)' })
    expect((await httpsOf({ httpGet: answers(526) })).detail).toMatch(/does not trust the server's certificate \(526\)/)
  })

  it('fails on other server errors', async () => {
    expect(await httpsOf({ httpGet: answers(502) })).toEqual({ state: 'fail', detail: 'the site answered with an error (status 502)' })
  })

  it('leaves the served certificate empty when the server probe fails or finds nothing', async () => {
    const failed = await verifyHttps(deps({ probeServer: async () => { throw new Error('ssh down') } }))
    expect(failed.names[0]).toMatchObject({ served: null, https: { state: 'ok' } })
    expect((await verifyHttps(deps({ probeServer: async () => ({}) }))).names[0].served).toBeNull()
  })

  it('probes the server once for all names', async () => {
    const probeServer = vi.fn(async () => ({}))
    await verifyHttps(deps({ names: ['a.example.com', 'b.example.com'], probeServer }))
    expect(probeServer).toHaveBeenCalledTimes(1)
  })
})

describe('verifyHttps renewal and timer', () => {
  it('passes when the renewal test exits 0 and a timer is active', async () => {
    const result = await verifyHttps(deps())
    expect(result.renewalTest).toEqual({ state: 'ok', detail: 'renewal test passed' })
    expect(result.timer).toEqual({ state: 'ok', detail: 'renewal timer is active (snap.certbot.renew.timer)' })
  })

  it('fails with the last meaningful line of the renewal output', async () => {
    const output = 'Processing /etc/letsencrypt/renewal/app.example.com.conf\nFailed to renew certificate app.example.com with error: Some challenges have failed.\n- - - - - - - - -\n\n'
    const result = await verifyHttps(deps({ renewalTest: async () => ({ code: 1, output }) }))
    expect(result.renewalTest).toEqual({ state: 'fail', detail: 'Failed to renew certificate app.example.com with error: Some challenges have failed.' })
  })

  it('fails with the reason when the renewal test cannot run, for example while another task holds the server', async () => {
    const busy = new Error('Another certificate task is already running on this server. Wait for it to finish.')
    const result = await verifyHttps(deps({ renewalTest: async () => { throw busy } }))
    expect(result.renewalTest).toEqual({ state: 'fail', detail: busy.message })
  })

  it('fails when no renewal timer is active and stays unknown when detection fails', async () => {
    expect((await verifyHttps(deps({ detect: async () => ({ renewalTimer: null }) as PrepFacts }))).timer).toEqual({ state: 'fail', detail: 'no renewal timer is active' })
    expect((await verifyHttps(deps({ detect: async () => { throw new Error('ssh down') } }))).timer).toEqual({ state: 'unknown', detail: 'ssh down' })
  })
})

describe('lastMeaningfulLine', () => {
  it('skips blank and separator lines', () => {
    expect(lastMeaningfulLine('first\nsecond\n\n- - - -\n  \n')).toBe('second')
    expect(lastMeaningfulLine('')).toBe('no output')
  })
})
