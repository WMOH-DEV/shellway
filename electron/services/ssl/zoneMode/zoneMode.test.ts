import { describe, expect, it, vi } from 'vitest'
import type { SslMode } from '../../../../src/types/ssl'
import type { ProxiedRecord } from '../CloudflareClient'
import type { OriginProbe, ProbeOutcome } from './probeOrigin'
import { preflightZone, setZoneMode, type ZoneModeClient } from './zoneMode'

const ZONE = { id: 'z1', name: 'example.com' }
const PASS: ProbeOutcome = { state: 'pass', detail: 'ok' }
const FAIL: ProbeOutcome = { state: 'fail', detail: 'the origin certificate has expired' }
const UNKNOWN: ProbeOutcome = { state: 'unknown', detail: "couldn't reach the origin from this computer" }

const record = (name: string, content = '203.0.113.10', type = 'A'): ProxiedRecord => ({ type, name, content })

function build(records: ProxiedRecord[], outcomes: Record<string, ProbeOutcome>, currentMode: SslMode | null = 'full') {
  const client = {
    findZone: vi.fn(async (name: string) => {
      if (name !== ZONE.name) throw new Error(`${name} is not a zone in this Cloudflare account.`)
      return ZONE
    }),
    currentSslMode: vi.fn(async () => currentMode),
    listProxiedRecords: vi.fn(async () => records),
    setSslMode: vi.fn(async () => {})
  } satisfies ZoneModeClient
  const probe: OriginProbe = vi.fn(async (target) => outcomes[target.name] ?? PASS)
  return { client, probe, deps: { client, probe } }
}

describe('preflightZone', () => {
  it('probes each proxied record and reports the current mode', async () => {
    const { deps, probe } = build([record('app.example.com'), record('www.example.com', 'app.example.com', 'CNAME')], {})
    const result = await preflightZone('example.com', deps)
    expect(result).toEqual({
      zoneId: 'z1',
      zone: 'example.com',
      currentMode: 'full',
      hosts: [
        { name: 'app.example.com', recordType: 'A', origin: '203.0.113.10', state: 'pass', detail: 'ok' },
        { name: 'www.example.com', recordType: 'CNAME', origin: 'app.example.com', state: 'pass', detail: 'ok' }
      ],
      blockedReason: null
    })
    expect(probe).toHaveBeenCalledWith({ name: 'www.example.com', recordType: 'CNAME', origin: 'app.example.com' })
  })

  it('blocks and names every failing hostname once', async () => {
    const { deps } = build([record('a.example.com'), record('b.example.com'), record('b.example.com', '203.0.113.11')], { 'a.example.com': FAIL, 'b.example.com': FAIL })
    const result = await preflightZone('example.com', deps)
    expect(result.blockedReason).toBe('These hostnames would break with Full (strict): a.example.com, b.example.com')
  })

  it('does not block on unknown hostnames', async () => {
    const { deps } = build([record('a.example.com')], { 'a.example.com': UNKNOWN })
    expect((await preflightZone('example.com', deps)).blockedReason).toBeNull()
  })

  it('blocks when the zone is already strict', async () => {
    const { deps } = build([record('a.example.com')], {}, 'strict')
    expect((await preflightZone('example.com', deps)).blockedReason).toBe('This zone is already set to Full (strict).')
  })

  it('marks a wildcard record unknown without probing it', async () => {
    const { deps, probe } = build([record('*.example.com')], {})
    const result = await preflightZone('example.com', deps)
    expect(result.hosts[0].state).toBe('unknown')
    expect(probe).not.toHaveBeenCalled()
  })

  it('probes six at a time at most and never retries', async () => {
    let running = 0
    let peak = 0
    const probe: OriginProbe = vi.fn(async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return UNKNOWN
    })
    const records = Array.from({ length: 20 }, (_, i) => record(`h${i}.example.com`, `203.0.113.${i + 1}`))
    const { client } = build(records, {})
    await preflightZone('example.com', { client, probe })
    expect(peak).toBe(6)
    expect(probe).toHaveBeenCalledTimes(20)
  })

  it('fails plainly for a zone the token cannot see', async () => {
    const { deps } = build([], {})
    await expect(preflightZone('other.example.net', deps)).rejects.toThrow('is not a zone in this Cloudflare account')
  })
})

describe('setZoneMode strict', () => {
  it('refuses when any hostname fails and does not touch Cloudflare', async () => {
    const { deps, client } = build([record('a.example.com'), record('b.example.com')], { 'b.example.com': FAIL })
    await expect(setZoneMode('example.com', 'strict', [], deps)).rejects.toThrow('These hostnames would break with Full (strict): b.example.com')
    expect(client.setSslMode).not.toHaveBeenCalled()
  })

  it('refuses unknown hostnames the user has not confirmed', async () => {
    const { deps, client } = build([record('a.example.com'), record('b.example.com')], { 'a.example.com': UNKNOWN, 'b.example.com': UNKNOWN })
    await expect(setZoneMode('example.com', 'strict', ['b.example.com'], deps)).rejects.toThrow('need your confirmation: a.example.com')
    expect(client.setSslMode).not.toHaveBeenCalled()
  })

  it('still refuses a failing hostname that was listed as confirmed', async () => {
    const { deps, client } = build([record('a.example.com')], { 'a.example.com': FAIL })
    await expect(setZoneMode('example.com', 'strict', ['a.example.com'], deps)).rejects.toThrow('would break')
    expect(client.setSslMode).not.toHaveBeenCalled()
  })

  it('refuses when the zone is already strict', async () => {
    const { deps, client } = build([record('a.example.com')], {}, 'strict')
    await expect(setZoneMode('example.com', 'strict', [], deps)).rejects.toThrow('already set to Full (strict)')
    expect(client.setSslMode).not.toHaveBeenCalled()
  })

  it('sets strict once everything passes or is confirmed, and returns the previous mode', async () => {
    const { deps, client } = build([record('a.example.com'), record('b.example.com')], { 'b.example.com': UNKNOWN }, 'flexible')
    const result = await setZoneMode('example.com', 'strict', ['B.example.com'], deps)
    expect(result).toEqual({ zone: 'example.com', previousMode: 'flexible', mode: 'strict' })
    expect(client.setSslMode).toHaveBeenCalledWith('z1', 'strict')
  })
})

describe('setZoneMode set back', () => {
  it.each(['full', 'flexible', 'off'] as const)('sets %s without any preflight', async (mode) => {
    const { deps, client, probe } = build([record('a.example.com')], { 'a.example.com': FAIL }, 'strict')
    const result = await setZoneMode('example.com', mode, [], deps)
    expect(result).toEqual({ zone: 'example.com', previousMode: 'strict', mode })
    expect(client.setSslMode).toHaveBeenCalledWith('z1', mode)
    expect(client.listProxiedRecords).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
  })

  it('refuses any other mode', async () => {
    const { deps, client } = build([], {})
    await expect(setZoneMode('example.com', 'origin_pull', [], deps)).rejects.toThrow('cannot be set from here')
    expect(client.setSslMode).not.toHaveBeenCalled()
  })
})
