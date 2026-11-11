import { describe, expect, it } from 'vitest'
import type { PortForwardRule } from '@/types/session'
import { emptyForm, formatTraffic, reachableAddress, routeText, ruleFromForm, validateForm } from './portForwardRules'

const form = (change: Partial<ReturnType<typeof emptyForm>> = {}) => ({
  ...emptyForm(),
  sourcePort: '7777',
  destinationPort: '3306',
  ...change
})

const saved = (change: Partial<PortForwardRule>): PortForwardRule => ({
  id: 'x',
  type: 'local',
  sourceHost: '127.0.0.1',
  sourcePort: 7777,
  destinationHost: '127.0.0.1',
  destinationPort: 3306,
  autoStart: false,
  enabled: true,
  ...change
})

describe('validateForm', () => {
  it('accepts a complete rule', () => {
    expect(validateForm(form(), [])).toEqual({})
  })

  it.each([
    ['0', 'Use a port from 1 to 65535'],
    ['65536', 'Use a port from 1 to 65535'],
    ['80.5', 'Use a port from 1 to 65535'],
    ['abc', 'Use a port from 1 to 65535'],
    ['', 'Enter a port']
  ])('rejects the listen port %j', (sourcePort, message) => {
    expect(validateForm(form({ sourcePort }), [])).toEqual({ sourcePort: message })
  })

  it('needs a destination except for a SOCKS proxy', () => {
    expect(validateForm(form({ destinationHost: ' ', destinationPort: '' }), [])).toEqual({
      destinationHost: 'Enter a host',
      destinationPort: 'Enter a port'
    })
    expect(validateForm(form({ type: 'dynamic', destinationHost: '', destinationPort: '' }), [])).toEqual({})
  })

  it('spots a port another rule already listens on, on the same side', () => {
    const other = saved({ name: 'Cache' })
    expect(validateForm(form(), [other])).toEqual({ sourcePort: '"Cache" already uses port 7777' })
    expect(validateForm(form({ type: 'dynamic' }), [other])).toEqual({ sourcePort: '"Cache" already uses port 7777' })
    expect(validateForm(form({ type: 'remote' }), [other])).toEqual({})
  })
})

describe('ruleFromForm', () => {
  it('drops the destination of a SOCKS proxy and trims text', () => {
    expect(ruleFromForm(form({ type: 'dynamic', name: '  ', sourceHost: ' 127.0.0.1 ' }), 'r1')).toEqual({
      id: 'r1',
      type: 'dynamic',
      name: undefined,
      sourceHost: '127.0.0.1',
      sourcePort: 7777,
      destinationHost: undefined,
      destinationPort: undefined,
      autoStart: false,
      enabled: true
    })
  })
})

describe('addresses', () => {
  it('turns a listen-on-everything host into one apps can use', () => {
    expect(reachableAddress(saved({ sourceHost: '0.0.0.0' }))).toBe('127.0.0.1:7777')
    expect(reachableAddress(saved({ sourceHost: '::1' }))).toBe('[::1]:7777')
  })

  it('describes where traffic goes for each type', () => {
    expect(routeText(saved({}))).toBe('127.0.0.1:7777 on this computer → 127.0.0.1:3306 from the server')
    expect(routeText(saved({ type: 'remote', sourcePort: 9000, destinationPort: 3000 }))).toBe(
      '127.0.0.1:9000 on the server → 127.0.0.1:3000 on this computer'
    )
    expect(routeText(saved({ type: 'dynamic', sourcePort: 1080 }))).toBe('127.0.0.1:1080 on this computer → any host, through the server')
  })
})

describe('formatTraffic', () => {
  it('shows small amounts in bytes instead of 0 KB', () => {
    expect(formatTraffic(0)).toBe('0 B')
    expect(formatTraffic(612)).toBe('612 B')
    expect(formatTraffic(4096)).toBe('4 KB')
  })
})
