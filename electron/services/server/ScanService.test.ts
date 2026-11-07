import { describe, expect, it, vi } from 'vitest'
import type { ProbeDefinition } from '../../../src/types/server/core'
import { sudoProbe } from '../../../src/utils/server/core/sudo'
import { FACTS_TTL_MS, ScanService } from './ScanService'
import { FakeRemoteExec } from './testing/FakeRemoteExec'

const probe = (id: string, overrides: Partial<ProbeDefinition> = {}): ProbeDefinition => ({
  id,
  area: 'software',
  root: false,
  timeoutSeconds: 20,
  script: `echo ${id}`,
  parse: (stdout) => stdout.trim(),
  ...overrides
})

function setup(probes: ProbeDefinition[], sudo = 'ok') {
  const fake = new FakeRemoteExec().on((call) => call.stdin?.includes('sudo=missing') ?? false, { stdout: `user=deploy\nsudo=${sudo}\n` })
  let clock = 1000
  let connected = true
  const broadcast = vi.fn()
  const scan = new ScanService({ execFor: () => (connected ? fake.exec : null), broadcast, now: () => clock, probes: [sudoProbe, ...probes] })
  return { fake, scan, broadcast, tick: (ms: number) => { clock += ms }, disconnect: () => { connected = false } }
}

describe('ScanService', () => {
  it('runs a probe through timeout with the script on stdin and broadcasts the facts', async () => {
    const { fake, scan, broadcast } = setup([probe('software.a')])
    fake.on('echo software.a', { stdout: 'hello\n' })
    const facts = await scan.scan('c1', ['software.a'], false)
    expect(facts['software.a']).toEqual({ status: 'ok', data: 'hello', at: 1000 })
    expect(fake.calls[0].command).toBe('timeout -k 5 20 sh -s')
    expect(fake.calls[0].stdin).toBe('{\necho software.a\n} </dev/null\n')
    expect(broadcast).toHaveBeenCalledWith('server:facts', 'c1', facts)
  })

  it('reuses results younger than 30 seconds unless forced', async () => {
    const { fake, scan, tick } = setup([probe('software.a')])
    await scan.scan('c1', ['software.a'], false)
    tick(FACTS_TTL_MS - 1)
    await scan.scan('c1', ['software.a'], false)
    expect(fake.calls).toHaveLength(1)
    await scan.scan('c1', ['software.a'], true)
    tick(FACTS_TTL_MS)
    await scan.scan('c1', ['software.a'], false)
    expect(fake.calls).toHaveLength(3)
  })

  it('shares a probe that is already running', async () => {
    const { fake, scan } = setup([probe('software.a')])
    await Promise.all([scan.scan('c1', ['software.a'], true), scan.scan('c1', ['software.a'], true)])
    expect(fake.calls).toHaveLength(1)
  })

  it('runs root probes with sudo -n when sudo needs no password', async () => {
    const { fake, scan } = setup([probe('security.ufw', { root: true })])
    fake.on('echo security.ufw', { stdout: 'active' })
    const facts = await scan.scan('c1', ['security.ufw'], false)
    expect(facts['security.ufw']).toMatchObject({ status: 'ok', data: 'active' })
    expect(fake.calls.map((call) => call.command)).toEqual(['timeout -k 5 10 sh -s', 'sudo -n timeout -k 5 20 sh -s'])
  })

  it('marks root probes unavailable without passwordless sudo and never runs them', async () => {
    const { fake, scan } = setup([probe('security.ufw', { root: true })], 'password')
    const facts = await scan.scan('c1', ['security.ufw'], false)
    expect(facts['security.ufw']).toEqual({ status: 'unavailable', reason: 'Needs passwordless sudo for deploy', at: 1000 })
    expect(fake.calls.map((call) => call.command)).toEqual(['timeout -k 5 10 sh -s'])
  })

  it('marks a root probe unavailable when sudo refuses at run time', async () => {
    const { fake, scan } = setup([probe('security.ufw', { root: true })])
    fake.on('echo security.ufw', { code: 1, stderr: 'sudo: a password is required\n' })
    expect((await scan.scan('c1', ['security.ufw'], false))['security.ufw'].status).toBe('unavailable')
  })

  it('turns timeouts, failures, parse errors and unknown ids into errors', async () => {
    const { fake, scan } = setup([probe('a.slow'), probe('a.broken'), probe('a.bad', { parse: () => { throw new Error('bad line') } }), probe('a.gone')])
    fake.on('echo a.slow', { code: 124 }).on('echo a.broken', { code: 2, stderr: 'sh: 1: oops\n' }).on('echo a.gone', new Error('Channel open failure'))
    const facts = await scan.scan('c1', ['a.slow', 'a.broken', 'a.bad', 'a.gone', 'a.unknown'], false)
    expect(facts['a.slow']).toMatchObject({ status: 'error', error: 'Timed out after 20 seconds' })
    expect(facts['a.broken']).toMatchObject({ status: 'error', error: 'sh: 1: oops' })
    expect(facts['a.bad']).toMatchObject({ status: 'error', error: 'Could not read the result: bad line' })
    expect(facts['a.gone']).toMatchObject({ status: 'error', error: 'Channel open failure' })
    expect(facts['a.unknown']).toMatchObject({ status: 'error', error: 'Unknown probe a.unknown' })
  })

  it('parses output even when the script exits non-zero', async () => {
    const { fake, scan } = setup([probe('a.partial')])
    fake.on('echo a.partial', { code: 1, stdout: 'some data\n' })
    expect((await scan.scan('c1', ['a.partial'], false))['a.partial']).toMatchObject({ status: 'ok', data: 'some data' })
  })

  it('runs at most three probes at once per connection', async () => {
    const probes = ['a.1', 'a.2', 'a.3', 'a.4', 'a.5'].map((id) => probe(id))
    const { fake, scan } = setup(probes)
    let running = 0
    let peak = 0
    fake.on(() => true, async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return { stdout: 'ok' }
    })
    await scan.scan('c1', probes.map((p) => p.id), false)
    expect(peak).toBe(3)
  })

  it('scans every probe for null and forgets the cache on disconnect', async () => {
    const { fake, scan, disconnect } = setup([probe('a.1')])
    expect(Object.keys(await scan.scan('c1', null, false)).sort()).toEqual(['a.1', 'core.sudo'])
    expect(Object.keys(scan.facts('c1'))).toHaveLength(2)
    scan.forget('c1')
    expect(scan.facts('c1')).toEqual({})
    disconnect()
    await expect(scan.scan('c1', null, false)).rejects.toThrow('Not connected')
    expect(fake.calls).toHaveLength(2)
  })
})
