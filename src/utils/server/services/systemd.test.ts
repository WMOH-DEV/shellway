import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { isUsefulUnit, parseSystemd } from './systemd'

const fixture = readFileSync(join(__dirname, 'fixtures/systemd.txt'), 'utf8')

function units() {
  const data = parseSystemd(fixture)
  if (!data.installed) throw new Error('expected systemd')
  return data.units
}

const byName = (name: string) => units().find((unit) => unit.name === name)

describe('parseSystemd', () => {
  it('keeps useful units, failed ones and installed stopped ones, and drops noise', () => {
    expect(units().map((unit) => unit.name)).toEqual(['acme-api', 'certbot', 'mysql', 'nginx', 'php8.2-fpm', 'php8.3-fpm', 'redis-server', 'ssh', 'systemd-networkd-wait-online', 'ufw'])
  })

  it('reads systemctl show records whose Id line comes after Type, memory and CPU', () => {
    expect(byName('systemd-networkd-wait-online')).toMatchObject({ active: 'failed', runsOnce: true, sinceSeconds: 259201 })
    expect(byName('nginx')?.runsOnce).toBe(false)
    expect(byName('redis-server')).toMatchObject({ memoryBytes: null, runsOnce: false })
  })

  it('does not treat a oneshot unit that a timer runs as a run-once unit', () => {
    expect(byName('certbot')).toMatchObject({ active: 'failed', runsOnce: false })
  })

  it('computes CPU from two samples and memory from MemoryCurrent', () => {
    expect(byName('nginx')).toMatchObject({ cpuPercent: 0.4, memoryBytes: 39845888, enabled: true, sinceSeconds: 2159941 })
    expect(byName('php8.3-fpm')).toMatchObject({ cpuPercent: 3.1, memoryBytes: null })
  })

  it('reports how long ago a failed unit stopped', () => {
    expect(byName('redis-server')).toMatchObject({ active: 'failed', sinceSeconds: 121, cpuPercent: null, memoryBytes: null, description: 'Advanced key-value store' })
  })

  it('adds installed units that are not loaded as stopped', () => {
    expect(byName('php8.2-fpm')).toMatchObject({ active: 'inactive', sub: 'dead', enabled: false })
  })

  it('returns not installed when systemctl is missing', () => {
    expect(parseSystemd('@@missing\n')).toEqual({ installed: false })
  })

  it('handles an empty but valid output', () => {
    expect(parseSystemd('@@units\n@@files\n')).toEqual({ installed: true, units: [] })
  })
})

describe('isUsefulUnit', () => {
  it.each([
    ['nginx', 'inactive', 'dead', true],
    ['systemd-resolved', 'active', 'running', false],
    ['systemd-resolved', 'failed', 'failed', true],
    ['my-app', 'active', 'running', true],
    ['my-app', 'inactive', 'dead', false],
    ['user@1000', 'active', 'running', false],
    ['snap.certbot.renew', 'inactive', 'dead', true]
  ])('%s %s/%s -> %s', (name, active, sub, expected) => {
    expect(isUsefulUnit({ name, active, sub })).toBe(expected)
  })
})
