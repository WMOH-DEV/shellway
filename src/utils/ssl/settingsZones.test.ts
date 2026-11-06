import { describe, expect, it } from 'vitest'
import type { EdgeInfo, HostnameStatus } from '../../types/ssl'
import { hostnameCount, hostnamesOutsideZones, outsideZonesWarning, ZONE_NOT_VISIBLE_REASON, zoneCoverage } from './settingsZones'

const edge = (zone: string | null, unknownReason: string | null = null): EdgeInfo => ({
  state: zone ? 'proxied' : 'unknown',
  zone,
  recordType: null,
  recordContent: null,
  sslMode: null,
  unknownReason
})

const host = (name: string, info: EdgeInfo, wildcard = false): HostnameStatus => ({
  name,
  blockId: 'b1',
  wildcard,
  origin: null,
  lineage: null,
  edge: info,
  verdict: 'ok',
  reason: '',
  uncheckedSide: null
})

const zones = [
  { id: 'z1', name: 'example.com' },
  { id: 'z2', name: 'example.org' }
]

it('keeps the reason the Cloudflare client reports for hosts outside every zone', () => {
  expect(ZONE_NOT_VISIBLE_REASON).toBe('zone not visible to the Cloudflare token')
})

describe('zoneCoverage', () => {
  it('counts distinct hostnames per visible zone, including zones with none', () => {
    const hostnames = [
      host('app.example.com', edge('example.com')),
      host('api.example.com', edge('example.com')),
      host('app.example.com', edge('example.com'))
    ]
    expect(zoneCoverage(zones, hostnames).map((c) => c.hostnames)).toEqual([2, 0])
  })

  it('ignores wildcard names', () => {
    const hostnames = [host('*.example.com', edge('example.com'), true)]
    expect(zoneCoverage(zones, hostnames)[0].hostnames).toBe(0)
  })
})

describe('hostnamesOutsideZones', () => {
  it('lists only hosts whose zone is not visible, sorted and without duplicates', () => {
    const hidden = edge(null, ZONE_NOT_VISIBLE_REASON)
    const hostnames = [
      host('b.example.net', hidden),
      host('a.example.net', hidden),
      host('b.example.net', hidden),
      host('plain.example.io', { ...edge(null), state: 'not-on-cloudflare' }),
      host('failed.example.io', edge(null, 'DNS lookup failed')),
      host('app.example.com', edge('example.com'))
    ]
    expect(hostnamesOutsideZones(hostnames)).toEqual(['a.example.net', 'b.example.net'])
  })
})

describe('copy', () => {
  it('pluralises the hostname count', () => {
    expect(hostnameCount(1)).toBe('1 hostname')
    expect(hostnameCount(0)).toBe('0 hostnames')
  })

  it('has no warning when every hostname is covered', () => {
    expect(outsideZonesWarning([])).toBeNull()
  })

  it('names one or several hostnames', () => {
    expect(outsideZonesWarning(['a.example.net'])).toBe('a.example.net is not in a zone this token can see. Add its zone to the token to check the Cloudflare side.')
    expect(outsideZonesWarning(['a.example.net', 'b.example.io'])).toContain('a.example.net, b.example.io are not in a zone')
  })
})
