import { describe, expect, it, vi } from 'vitest'
import type { SslMode, SslReport } from '../../../src/types/ssl'
import type { CloudflareClient } from './CloudflareClient'
import { SslCoordinator } from './SslCoordinator'
import type { SslLocalStore } from './SslLocalStore'
import type { OriginProbe } from './zoneMode/probeOrigin'

const failing: OriginProbe = async () => ({ state: 'fail', detail: 'the origin certificate has expired' })
const passing: OriginProbe = async () => ({ state: 'pass', detail: 'ok' })

function build(token: string | null, probe: OriginProbe) {
  const mode = { current: 'full' as SslMode }
  const client = {
    findZone: vi.fn(async () => ({ id: 'z1', name: 'example.com' })),
    currentSslMode: vi.fn(async (): Promise<SslMode> => mode.current),
    listProxiedRecords: vi.fn(async () => [{ type: 'A', name: 'app.example.com', content: '203.0.113.10' }]),
    setSslMode: vi.fn(async () => {})
  }
  const coordinator = new SslCoordinator({
    execFor: () => null,
    store: { cloudflareToken: () => token } as unknown as SslLocalStore,
    cloudflare: () => client as unknown as CloudflareClient,
    zoneProbe: probe,
    broadcast: vi.fn(),
    notify: vi.fn(),
    now: () => 1_800_000_000_000
  })
  return { coordinator, client, mode }
}

const reportInZone = (zone: string) => ({ hostnames: [{ edge: { zone } }] }) as unknown as SslReport

function remember(coordinator: SslCoordinator, connectionId: string, sessionId: string, zone: string): void {
  const internals = coordinator as unknown as { reports: Map<string, SslReport>; checkedSessions: Map<string, string> }
  internals.reports.set(connectionId, reportInZone(zone))
  internals.checkedSessions.set(connectionId, sessionId)
}

describe('SslCoordinator zone SSL mode', () => {
  it('needs a saved token for both calls', async () => {
    const { coordinator, client } = build(null, passing)
    await expect(coordinator.zonePreflight('example.com')).rejects.toThrow('Add a Cloudflare token first.')
    await expect(coordinator.zoneSetMode('example.com', 'strict', [])).rejects.toThrow('Add a Cloudflare token first.')
    expect(client.setSslMode).not.toHaveBeenCalled()
  })

  it('returns the preflight with the blocking reason', async () => {
    const { coordinator } = build('token', failing)
    const result = await coordinator.zonePreflight('example.com')
    expect(result.blockedReason).toBe('These hostnames would break with Full (strict): app.example.com')
  })

  it('refuses strict in the main process when a hostname fails, and does not refresh anything', async () => {
    const { coordinator, client } = build('token', failing)
    const check = vi.spyOn(coordinator, 'check')
    remember(coordinator, 'c1', 's1', 'example.com')
    await expect(coordinator.zoneSetMode('example.com', 'strict', ['app.example.com'])).rejects.toThrow('would break')
    expect(client.setSslMode).not.toHaveBeenCalled()
    expect(check).not.toHaveBeenCalled()
  })

  it('refreshes only the connections that use the changed zone', async () => {
    const { coordinator, client } = build('token', passing)
    const check = vi.spyOn(coordinator, 'check').mockResolvedValue(reportInZone('example.com'))
    remember(coordinator, 'c1', 's1', 'example.com')
    remember(coordinator, 'c2', 's2', 'example.net')
    const result = await coordinator.zoneSetMode('example.com', 'strict', [])
    expect(result).toEqual({ zone: 'example.com', previousMode: 'full', mode: 'strict' })
    expect(client.setSslMode).toHaveBeenCalledWith('z1', 'strict')
    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledWith('c1', 's1')
  })

  it('only sets a zone back to the mode it had before Shellway made it strict', async () => {
    const { coordinator, client, mode } = build('token', passing)
    vi.spyOn(coordinator, 'check').mockResolvedValue(reportInZone('example.com'))
    mode.current = 'strict'
    await expect(coordinator.zoneSetMode('example.com', 'full', [])).rejects.toThrow('only sets a zone back')
    mode.current = 'flexible'
    await coordinator.zoneSetMode('example.com', 'strict', [])
    mode.current = 'strict'
    await expect(coordinator.zoneSetMode('example.com', 'off', [])).rejects.toThrow('only sets a zone back')
    await coordinator.zoneSetMode('example.com', 'flexible', [])
    expect(client.setSslMode.mock.calls).toEqual([['z1', 'strict'], ['z1', 'flexible']])
  })
})
