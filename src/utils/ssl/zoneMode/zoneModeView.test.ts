import { describe, expect, it } from 'vitest'
import type { ZoneHostProbe, ZonePreflight } from '../../../types/ssl'
import { edgeOf, makeHost } from '../testReport'
import { blockedMessage, canApplyStrict, confirmedNames, modeLabel, probeView, revertableMode, sortedProbes, strictOfferZone, zoneSslMode } from './zoneModeView'

const probe = (overrides: Partial<ZoneHostProbe>): ZoneHostProbe => ({
  name: 'app.example.com',
  recordType: 'A',
  origin: '203.0.113.10',
  state: 'pass',
  detail: '',
  ...overrides
})

const preflight = (hosts: ZoneHostProbe[], overrides: Partial<ZonePreflight> = {}): ZonePreflight => ({
  zoneId: 'z1',
  zone: 'example.com',
  currentMode: 'flexible',
  hosts,
  blockedReason: null,
  ...overrides
})

describe('strictOfferZone', () => {
  it('offers the zone for a proxied host whose mode is not strict', () => {
    expect(strictOfferZone(edgeOf({ sslMode: 'flexible' }))).toBe('example.com')
    expect(strictOfferZone(edgeOf({ sslMode: null }))).toBe('example.com')
  })

  it('offers nothing when the zone is already strict or the host is not proxied', () => {
    expect(strictOfferZone(edgeOf({ sslMode: 'strict' }))).toBeNull()
    expect(strictOfferZone(edgeOf({ state: 'dns-only', sslMode: 'flexible' }))).toBeNull()
    expect(strictOfferZone(edgeOf({ zone: null, sslMode: 'flexible' }))).toBeNull()
  })
})

describe('zoneSslMode', () => {
  it('reads the mode from a hostname in that zone', () => {
    const hosts = [makeHost({ edge: edgeOf({ zone: 'example.net', sslMode: 'full' }) }), makeHost({ edge: edgeOf({ sslMode: 'flexible' }) })]
    expect(zoneSslMode('example.com', hosts)).toBe('flexible')
    expect(zoneSslMode('example.org', hosts)).toBeNull()
  })
})

describe('probeView', () => {
  it('words each state, with the reason for failures and unknowns', () => {
    expect(probeView(probe({}))).toEqual({ tone: 'success', text: 'Passes' })
    expect(probeView(probe({ state: 'fail', detail: 'certificate expired' }))).toEqual({ tone: 'error', text: 'Would break: certificate expired' })
    expect(probeView(probe({ state: 'unknown', detail: 'connection timed out' }))).toEqual({ tone: 'warning', text: "Couldn't check: connection timed out" })
  })
})

describe('applying', () => {
  const failing = preflight([probe({ state: 'fail', detail: 'self-signed' }), probe({ name: 'b.example.com' })])
  const unknown = preflight([probe({ state: 'unknown', name: 'x.example.com' }), probe({ state: 'unknown', name: 'y.example.com' })])

  it('is blocked by a failing host or a blocked reason', () => {
    expect(canApplyStrict(failing, true)).toBe(false)
    expect(canApplyStrict(preflight([], { blockedReason: 'The token cannot edit zone settings' }), true)).toBe(false)
  })

  it('needs the confirmation when hosts could not be checked', () => {
    expect(canApplyStrict(unknown, false)).toBe(false)
    expect(canApplyStrict(unknown, true)).toBe(true)
    expect(canApplyStrict(preflight([probe({})]), false)).toBe(true)
  })

  it('sends the unknown names only when confirmed', () => {
    expect(confirmedNames(unknown, true)).toEqual(['x.example.com', 'y.example.com'])
    expect(confirmedNames(unknown, false)).toEqual([])
  })

  it('lists the failing names in the blocked message', () => {
    expect(blockedMessage(failing)).toContain('app.example.com')
    expect(blockedMessage(preflight([probe({})]))).toBeNull()
    expect(blockedMessage(preflight([], { blockedReason: 'No access' }))).toBe('No access')
  })
})

describe('helpers', () => {
  it('puts failures first', () => {
    const sorted = sortedProbes([probe({ name: 'a' }), probe({ name: 'b', state: 'unknown' }), probe({ name: 'c', state: 'fail' })])
    expect(sorted.map((h) => h.name)).toEqual(['c', 'b', 'a'])
  })

  it('labels modes and only reverts to a different known mode', () => {
    expect(modeLabel('strict')).toBe('Full (strict)')
    expect(modeLabel(null)).toBe('Unknown')
    expect(revertableMode('flexible')).toBe('flexible')
    expect(revertableMode('strict')).toBeNull()
    expect(revertableMode('origin_pull')).toBeNull()
    expect(revertableMode(null)).toBeNull()
  })
})
