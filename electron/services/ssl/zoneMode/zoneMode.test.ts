import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SslMode } from '../../../../src/types/ssl'
import type { ProxiedRecord } from '../CloudflareClient'
import type { OriginProbe, ProbeOutcome } from './probeOrigin'
import { preflightZone, setZoneMode, type ZoneChange, type ZoneModeClient } from './zoneMode'

const ZONE = { id: 'z1', name: 'example.com' }
const PASS: ProbeOutcome = { state: 'pass', detail: 'ok' }
const FAIL: ProbeOutcome = { state: 'fail', detail: 'the origin certificate has expired' }
const UNKNOWN: ProbeOutcome = { state: 'unknown', detail: "couldn't reach the origin from this computer" }

const record = (name: string, content = '203.0.113.10', type = 'A'): ProxiedRecord => ({ type, name, content })

function build(records: ProxiedRecord[], outcomes: Record<string, ProbeOutcome>, currentMode: SslMode | null = 'full', changes = new Map<string, ZoneChange>()) {
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
  return { client, probe, changes, deps: { client, changes, probe } }
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
        { name: 'www.example.com', recordType: 'CNAME', origin: '203.0.113.10', state: 'pass', detail: 'ok' }
      ],
      blockedReason: null
    })
    expect(probe).toHaveBeenCalledWith({ name: 'www.example.com', recordType: 'CNAME', origin: '203.0.113.10' })
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
    await preflightZone('example.com', { client, changes: new Map(), probe })
    expect(peak).toBe(6)
    expect(probe).toHaveBeenCalledTimes(20)
  })

  it('probes the address a CNAME ends up at, using the CNAME name', async () => {
    const records = [record('app.example.com', '203.0.113.10'), record('mid.example.com', 'App.Example.com.', 'CNAME'), record('www.example.com', 'mid.example.com', 'CNAME')]
    const { deps, probe } = build(records, {})
    const result = await preflightZone('example.com', deps)
    expect(probe).toHaveBeenCalledWith({ name: 'www.example.com', recordType: 'CNAME', origin: '203.0.113.10' })
    expect(probe).not.toHaveBeenCalledWith(expect.objectContaining({ origin: 'mid.example.com' }))
    expect(result.hosts.map((host) => host.state)).toEqual(['pass', 'pass', 'pass'])
  })

  it('probes every address behind a proxied CNAME target', async () => {
    const records = [record('app.example.com', '203.0.113.10'), record('app.example.com', '2001:db8::1', 'AAAA'), record('www.example.com', 'app.example.com', 'CNAME')]
    const { deps, probe } = build(records, {})
    await preflightZone('example.com', deps)
    expect(probe).toHaveBeenCalledWith({ name: 'www.example.com', recordType: 'CNAME', origin: '203.0.113.10' })
    expect(probe).toHaveBeenCalledWith({ name: 'www.example.com', recordType: 'CNAME', origin: '2001:db8::1' })
  })

  it('probes an unproxied in-zone CNAME target directly', async () => {
    const { deps, probe } = build([record('www.example.com', 'origin.example.com', 'CNAME')], {})
    await preflightZone('example.com', deps)
    expect(probe).toHaveBeenCalledWith({ name: 'www.example.com', recordType: 'CNAME', origin: 'origin.example.com' })
  })

  it('marks a CNAME that points outside the zone unknown without probing it', async () => {
    const { deps, probe } = build([record('www.example.com', 'Shop.Example.net.', 'CNAME')], {})
    const [host] = (await preflightZone('example.com', deps)).hosts
    expect(host).toMatchObject({ state: 'unknown', detail: 'points to shop.example.net, check that origin yourself' })
    expect(probe).not.toHaveBeenCalled()
  })

  it('marks a CNAME loop unknown instead of following it forever', async () => {
    const { deps, probe } = build([record('a.example.com', 'b.example.com', 'CNAME'), record('b.example.com', 'a.example.com', 'CNAME')], {})
    const result = await preflightZone('example.com', deps)
    expect(result.hosts.map((host) => host.state)).toEqual(['unknown', 'unknown'])
    expect(probe).not.toHaveBeenCalled()
  })

  it('gives up on a CNAME chain longer than five hops', async () => {
    const chain = Array.from({ length: 7 }, (_, i) => record(`c${i}.example.com`, `c${i + 1}.example.com`, 'CNAME'))
    const { deps, probe } = build([...chain, record('c7.example.com', '203.0.113.10')], {})
    const result = await preflightZone('example.com', deps)
    expect(result.hosts[0]).toMatchObject({ name: 'c0.example.com', state: 'unknown' })
    expect(result.hosts[5]).toMatchObject({ name: 'c5.example.com', state: 'pass' })
    expect(probe).toHaveBeenCalledWith({ name: 'c5.example.com', recordType: 'CNAME', origin: '203.0.113.10' })
  })

  it('probes at most 300 records and marks the rest not checked in time', async () => {
    const records = Array.from({ length: 305 }, (_, i) => record(`h${i}.example.com`, `203.0.113.${(i % 250) + 1}`))
    const { deps, probe } = build(records, {})
    const result = await preflightZone('example.com', deps)
    expect(probe).toHaveBeenCalledTimes(300)
    expect(result.hosts).toHaveLength(305)
    expect(result.hosts.slice(300).every((host) => host.state === 'unknown' && host.detail === 'not checked in time')).toBe(true)
  })

  describe('with a stuck probe', () => {
    afterEach(() => vi.useRealTimers())

    it('stops at the deadline and marks unfinished hostnames not checked in time', async () => {
      vi.useFakeTimers()
      const probe: OriginProbe = vi.fn((target) => (target.name === 'slow.example.com' ? new Promise<ProbeOutcome>(() => {}) : Promise.resolve(PASS)))
      const records = [record('fast.example.com'), record('slow.example.com', '203.0.113.11')]
      const { client } = build(records, {})
      const pending = preflightZone('example.com', { client, changes: new Map(), probe })
      await vi.advanceTimersByTimeAsync(90_000)
      const result = await pending
      expect(result.hosts).toEqual([
        expect.objectContaining({ name: 'fast.example.com', state: 'pass' }),
        expect.objectContaining({ name: 'slow.example.com', state: 'unknown', detail: 'not checked in time' })
      ])
    })

    it('does not set strict on a run that timed out until the hostname is confirmed', async () => {
      vi.useFakeTimers()
      const probe: OriginProbe = () => new Promise<ProbeOutcome>(() => {})
      const { client } = build([record('slow.example.com')], {})
      const run = setZoneMode('example.com', 'strict', [], { client, changes: new Map(), probe })
      const refusal = expect(run).rejects.toThrow('need your confirmation: slow.example.com')
      await vi.advanceTimersByTimeAsync(90_000)
      await refusal
      expect(client.setSslMode).not.toHaveBeenCalled()
    })
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

  it('remembers the mode a successful change replaced, and nothing for a refused one', async () => {
    const ok = build([record('a.example.com')], {}, 'flexible')
    await setZoneMode('example.com', 'strict', [], ok.deps)
    expect(ok.changes.get('z1')).toEqual({ previousMode: 'flexible' })
    const refused = build([record('a.example.com')], { 'a.example.com': FAIL }, 'flexible')
    await expect(setZoneMode('example.com', 'strict', [], refused.deps)).rejects.toThrow()
    expect(refused.changes.size).toBe(0)
  })
})

describe('setZoneMode set back', () => {
  const REFUSAL = 'Shellway only sets a zone back to the mode it had before Shellway changed it.'
  const remembered = (previousMode: SslMode | null) => new Map<string, ZoneChange>([['z1', { previousMode }]])

  it.each(['full', 'flexible', 'off'] as const)('sets %s without any preflight when that was the mode before Shellway changed it', async (mode) => {
    const { deps, client, probe, changes } = build([record('a.example.com')], { 'a.example.com': FAIL }, 'strict', remembered(mode))
    const result = await setZoneMode('example.com', mode, [], deps)
    expect(result).toEqual({ zone: 'example.com', previousMode: 'strict', mode })
    expect(client.setSslMode).toHaveBeenCalledWith('z1', mode)
    expect(client.listProxiedRecords).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(changes.has('z1')).toBe(false)
  })

  it('refuses a mode other than the remembered one', async () => {
    const { deps, client, changes } = build([], {}, 'strict', remembered('flexible'))
    await expect(setZoneMode('example.com', 'off', [], deps)).rejects.toThrow(REFUSAL)
    expect(client.setSslMode).not.toHaveBeenCalled()
    expect(changes.has('z1')).toBe(true)
  })

  it('refuses when Shellway never changed this zone', async () => {
    const { deps, client } = build([], {}, 'strict')
    await expect(setZoneMode('example.com', 'full', [], deps)).rejects.toThrow(REFUSAL)
    expect(client.setSslMode).not.toHaveBeenCalled()
  })

  it('refuses when the zone is no longer strict', async () => {
    const { deps, client } = build([], {}, 'off', remembered('full'))
    await expect(setZoneMode('example.com', 'full', [], deps)).rejects.toThrow(REFUSAL)
    expect(client.setSslMode).not.toHaveBeenCalled()
  })

  it('refuses when the previous mode was not known', async () => {
    const { deps, client } = build([], {}, 'strict', remembered(null))
    await expect(setZoneMode('example.com', 'full', [], deps)).rejects.toThrow(REFUSAL)
    expect(client.setSslMode).not.toHaveBeenCalled()
  })

  it('refuses any other mode', async () => {
    const { deps, client } = build([], {})
    await expect(setZoneMode('example.com', 'origin_pull', [], deps)).rejects.toThrow('cannot be set from here')
    expect(client.setSslMode).not.toHaveBeenCalled()
  })
})
