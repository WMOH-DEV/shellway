import { describe, expect, it } from 'vitest'
import { FRESH_INSTALL_DAYS, isFreshServer } from './fresh'
import { parseSystem, type SystemState } from './system'

const NOW = 1_800_000_000
const DAY = 86400

const system = (overrides: Partial<SystemState>): SystemState => ({ webServers: [], installedAt: NOW - 2 * DAY, bootedAt: NOW - DAY, now: NOW, ...overrides })

describe('parseSystem', () => {
  it('reads web servers, install time, boot time and the server clock', () => {
    expect(parseSystem('web=nginx\nweb=apache2\nweb=evil\ninstalled=1799000000\nnow=1800000000\nbooted=1799990000\n')).toEqual({
      webServers: ['nginx', 'apache2'],
      installedAt: 1799000000,
      bootedAt: 1799990000,
      now: 1800000000
    })
  })

  it('leaves unknown times empty', () => {
    expect(parseSystem('installed=\nnow=x\n')).toEqual({ webServers: [], installedAt: null, bootedAt: null, now: null })
  })
})

describe('isFreshServer', () => {
  it.each<[string, Partial<SystemState>, number | null, boolean]>([
    ['empty and installed 2 days ago', {}, 0, true],
    ['installed exactly at the limit', { installedAt: NOW - FRESH_INSTALL_DAYS * DAY }, 0, true],
    ['installed a day past the limit', { installedAt: NOW - (FRESH_INSTALL_DAYS + 1) * DAY }, 0, false],
    ['nginx installed', { webServers: ['nginx'] }, 0, false],
    ['has a deploy site', {}, 1, false],
    ['site count still loading', {}, null, false],
    ['install time unknown', { installedAt: null }, 0, false],
    ['server clock unknown', { now: null }, 0, false]
  ])('%s', (_name, overrides, siteCount, fresh) => {
    expect(isFreshServer({ system: system(overrides), siteCount })).toBe(fresh)
  })

  it('is not fresh before the system probe answers', () => {
    expect(isFreshServer({ system: null, siteCount: 0 })).toBe(false)
  })
})
