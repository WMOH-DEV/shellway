import { describe, expect, it } from 'vitest'
import type { ServerIdentity } from '@/types/server/identity'
import { addressLine, memoryLabel, osLabel, sizeLine, uptimeLabel } from './identityFormat'

const identity: ServerIdentity = {
  hostname: 'app',
  os: { family: 'ubuntu', id: 'ubuntu', versionId: '24.04', codename: 'noble', prettyName: 'Ubuntu 24.04.1 LTS' },
  kernel: '6.8.0',
  arch: 'x86_64',
  virtualization: 'kvm',
  cpus: 4,
  memoryBytes: 8_323_588_096,
  uptimeSeconds: 25 * 86400 + 3600,
  primaryIp: '203.0.113.10',
  sshPort: 22,
  user: 'deploy',
  timezone: 'UTC'
}

describe('identity format', () => {
  it('builds the size line like the screen', () => {
    expect(sizeLine(identity)).toBe('Ubuntu 24.04 · 4 vCPU · 8 GB')
  })

  it('builds the address line like the screen', () => {
    expect(addressLine(identity)).toBe('203.0.113.10 · up 25 d')
  })

  it('falls back to the pretty name when the os id is missing', () => {
    expect(osLabel({ ...identity.os, id: '' })).toBe('Ubuntu 24.04.1 LTS')
  })

  it.each([
    [512 * 1024 ** 2, '512 MB'],
    [2 * 1024 ** 3, '2 GB']
  ])('formats %d bytes of memory', (bytes, label) => {
    expect(memoryLabel(bytes)).toBe(label)
  })

  it.each([
    [30, 'up 1 min'],
    [600, 'up 10 min'],
    [7200, 'up 2 h'],
    [86400 * 3, 'up 3 d']
  ])('formats %d seconds of uptime', (seconds, label) => {
    expect(uptimeLabel(seconds)).toBe(label)
  })

  it('leaves out a missing ip', () => {
    expect(addressLine({ ...identity, primaryIp: '' })).toBe('up 25 d')
  })
})
