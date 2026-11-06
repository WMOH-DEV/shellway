import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Verdict } from '../../../src/types/ssl'
import { AlertProbe, alertLevel, type AlertProbeStore, type ProbeResult } from './AlertProbe'
import type { KnownHost } from './SslLocalStore'

const HOUR = 3_600_000
const DAY_S = 86_400
const NOW = 1_800_000_000_000

function memoryStore(hosts: Record<string, KnownHost[]>, enabled = true): AlertProbeStore & { probed: Map<string, number>; alerted: Map<string, number>; failures: Map<string, string | null> } {
  const probed = new Map<string, number>()
  const alerted = new Map<string, number>()
  const failures = new Map<string, string | null>()
  return {
    probed,
    alerted,
    failures,
    knownHosts: () => hosts,
    alertSettings: () => ({ probeEnabled: enabled, lastAlert: null, unreachable: [] }),
    probedAt: (host) => probed.get(host) ?? 0,
    markProbed: (host, at, failure) => { probed.set(host, at); failures.set(host, failure) },
    alertedAt: (host, verdict: Verdict) => alerted.get(`${host}:${verdict}`) ?? 0,
    markAlerted: (host, verdict: Verdict, at) => { alerted.set(`${host}:${verdict}`, at) }
  }
}

const expiresIn = (days: number): ProbeResult => ({ notAfter: NOW / 1000 + days * DAY_S })

describe('alertLevel', () => {
  it('alerts only inside the warning window', () => {
    expect(alertLevel(-1)).toBe('broken')
    expect(alertLevel(5)).toBe('will-break')
    expect(alertLevel(10)).toBe('expiring')
    expect(alertLevel(30)).toBeNull()
  })
})

describe('AlertProbe', () => {
  const host: KnownHost = { host: 'app.example.com', address: '203.0.113.10', port: 443 }
  let notify: ReturnType<typeof vi.fn>
  let now: number

  beforeEach(() => {
    notify = vi.fn()
    now = NOW
  })

  it('checks each host once per 12 hours and alerts with the days left', async () => {
    const store = memoryStore({ s1: [host], s2: [host] })
    const probe = vi.fn(async () => expiresIn(6))
    const alerts = new AlertProbe({ store, probe, notify, now: () => now })
    await alerts.runOnce()
    await alerts.runOnce()
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith(host)
    expect(notify).toHaveBeenCalledWith('Server certificate expires soon', 'app.example.com: server certificate expires in 6 days')
    now += 12 * HOUR
    await alerts.runOnce()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('sends the same alert at most once a day', async () => {
    const store = memoryStore({ s1: [host] })
    const alerts = new AlertProbe({ store, probe: async () => expiresIn(6), notify, now: () => now })
    await alerts.runOnce()
    now += 12 * HOUR
    await alerts.runOnce()
    expect(notify).toHaveBeenCalledTimes(1)
    now += 12 * HOUR
    await alerts.runOnce()
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('records a host it cannot reach once and waits for the next slot', async () => {
    const store = memoryStore({ s1: [host] })
    const probe = vi.fn(async () => { throw new Error('connect ETIMEDOUT') })
    const alerts = new AlertProbe({ store, probe, notify, now: () => now })
    await alerts.runOnce()
    await alerts.runOnce()
    expect(probe).toHaveBeenCalledTimes(1)
    expect(store.failures.get('app.example.com')).toBe("can't connect from this PC (connect ETIMEDOUT)")
    expect(notify).not.toHaveBeenCalled()
  })

  it('stays quiet for healthy certificates and when turned off', async () => {
    const healthy = new AlertProbe({ store: memoryStore({ s1: [host] }), probe: async () => expiresIn(60), notify, now: () => now })
    await healthy.runOnce()
    const probe = vi.fn(async () => expiresIn(1))
    const off = new AlertProbe({ store: memoryStore({ s1: [host] }, false), probe, notify, now: () => now })
    await off.runOnce()
    expect(probe).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('words an expired certificate', async () => {
    const alerts = new AlertProbe({ store: memoryStore({ s1: [host] }), probe: async () => expiresIn(-2), notify, now: () => now })
    await alerts.runOnce()
    expect(notify).toHaveBeenCalledWith('Server certificate expired', 'app.example.com: server certificate expired 2 days ago')
  })
})

describe('tlsProbe', () => {
  it('reads the expiry of the certificate a server presents for a name', async () => {
    const { execFileSync } = await import('child_process')
    const { mkdtempSync, readFileSync, rmSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const { createServer } = await import('tls')
    const { tlsProbe } = await import('./AlertProbe')
    const dir = mkdtempSync(join(tmpdir(), 'sw-tls-'))
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '9', '-subj', '/CN=app.example.com',
        '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore' })
      const server = createServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as { port: number }).port
      try {
        const { notAfter } = await tlsProbe({ host: 'app.example.com', address: '127.0.0.1', port })
        const days = (notAfter * 1000 - Date.now()) / 86_400_000
        expect(days).toBeGreaterThan(8)
        expect(days).toBeLessThanOrEqual(9)
      } finally {
        server.close()
      }
      await expect(tlsProbe({ host: 'app.example.com', address: '127.0.0.1', port })).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
