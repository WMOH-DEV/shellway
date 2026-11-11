import { describe, expect, it } from 'vitest'
import { parseForwardSpec } from './portForwardSpec'

const valid = {
  id: 'r1',
  type: 'local',
  name: 'db',
  sourceHost: '127.0.0.1',
  sourcePort: 7777,
  destinationHost: '127.0.0.1',
  destinationPort: 3306,
  autoStart: true
}

describe('parseForwardSpec', () => {
  it('keeps only the fields a forward needs', () => {
    expect(parseForwardSpec(valid)).toEqual({
      id: 'r1',
      type: 'local',
      name: 'db',
      sourceHost: '127.0.0.1',
      sourcePort: 7777,
      destinationHost: '127.0.0.1',
      destinationPort: 3306
    })
  })

  it('does not ask a SOCKS proxy for a destination', () => {
    expect(parseForwardSpec({ id: 's', type: 'dynamic', sourceHost: '127.0.0.1', sourcePort: 1080 })).toEqual({
      id: 's',
      type: 'dynamic',
      name: undefined,
      sourceHost: '127.0.0.1',
      sourcePort: 1080
    })
  })

  it.each([
    ['missing id', { id: '' }],
    ['unknown type', { type: 'magic' }],
    ['port zero', { sourcePort: 0 }],
    ['port above 65535', { destinationPort: 70000 }],
    ['fractional port', { sourcePort: 80.5 }],
    ['port as text', { sourcePort: '80' }],
    ['empty host', { destinationHost: '' }],
    ['host with spaces', { sourceHost: '127.0.0.1 -R' }],
    ['missing destination', { destinationHost: undefined }]
  ])('rejects %s', (_label, change) => {
    expect(() => parseForwardSpec({ ...valid, ...change })).toThrow(/^Invalid /)
  })
})
