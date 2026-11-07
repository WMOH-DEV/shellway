import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { IDENTITY_SCRIPT, osInfo, parseIdentity } from './identity'
import { parseSudo } from './sudo'

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8')

describe('parseIdentity', () => {
  it('reads an Ubuntu 24.04 server', () => {
    expect(parseIdentity(fixture('identity-ubuntu-24.04.txt'))).toEqual({
      hostname: 'web-01',
      os: { family: 'ubuntu', id: 'ubuntu', versionId: '24.04', codename: 'noble', prettyName: 'Ubuntu 24.04.1 LTS' },
      kernel: '6.8.0-45-generic',
      arch: 'x86_64',
      virtualization: 'kvm',
      cpus: 2,
      memoryBytes: 4010652 * 1024,
      uptimeSeconds: 356812,
      primaryIp: '203.0.113.10',
      sshPort: 22,
      user: 'deploy',
      timezone: 'Etc/UTC'
    })
  })

  it('reads a Debian 12 server without ip route and with a custom ssh port', () => {
    const identity = parseIdentity(fixture('identity-debian-12.txt'))
    expect(identity.os).toEqual({ family: 'debian', id: 'debian', versionId: '12', codename: 'bookworm', prettyName: 'Debian GNU/Linux 12 (bookworm)' })
    expect(identity.primaryIp).toBe('203.0.113.10')
    expect(identity.sshPort).toBe(2222)
    expect(identity.user).toBe('root')
    expect(identity.virtualization).toBe('none')
    expect(identity.timezone).toBe('Europe/Berlin')
  })

  it('reads a Rocky 9 server as the rhel family', () => {
    const identity = parseIdentity(fixture('identity-rocky-9.txt'))
    expect(identity.os.family).toBe('rhel')
    expect(identity.os.versionId).toBe('9.4')
    expect(identity.os.codename).toBe('')
    expect(identity.primaryIp).toBe('10.0.0.20')
    expect(identity.cpus).toBe(8)
  })

  it('keeps going when tools are missing', () => {
    const identity = parseIdentity(fixture('identity-alpine.txt'))
    expect(identity.os.family).toBe('other')
    expect(identity.primaryIp).toBe('')
    expect(identity.sshPort).toBe(0)
    expect(identity.virtualization).toBe('')
    expect(identity.timezone).toBe('Asia/Tokyo')
    expect(identity.memoryBytes).toBe(491520 * 1024)
  })

  it('returns empty values for empty output', () => {
    expect(parseIdentity('')).toMatchObject({ hostname: '', cpus: 0, memoryBytes: 0, uptimeSeconds: 0, sshPort: 0, os: { family: 'other', prettyName: 'Unknown' } })
  })

  it('runs under sh, exits 0 even where tools are missing, and reads the ssh port', () => {
    const result = spawnSync('/bin/sh', ['-s'], { input: `{\n${IDENTITY_SCRIPT}} </dev/null\n`, env: { PATH: process.env.PATH, SSH_CONNECTION: '198.51.100.7 53122 203.0.113.10 2222' }, encoding: 'utf8' })
    expect(result.status).toBe(0)
    const identity = parseIdentity(result.stdout)
    expect(identity.sshPort).toBe(2222)
    expect(identity.user).not.toBe('')
    expect(identity.kernel).not.toBe('')
  })
})

describe('osInfo', () => {
  it.each([
    ['ID=linuxmint\nID_LIKE="ubuntu debian"\nUBUNTU_CODENAME=noble\nVERSION_CODENAME=wilma', 'ubuntu', 'noble'],
    ['ID=raspbian\nID_LIKE=debian\nVERSION_CODENAME=bookworm', 'debian', 'bookworm'],
    ['ID="almalinux"\nID_LIKE="rhel centos fedora"', 'rhel', ''],
    ['ID=fedora', 'rhel', ''],
    ['ID=arch', 'other', '']
  ])('maps %j to %s', (text, family, codename) => {
    expect(osInfo(text)).toMatchObject({ family, codename })
  })
})

describe('parseSudo', () => {
  it('reads passwordless sudo', () => {
    expect(parseSudo('user=deploy\nsudo=ok\n')).toEqual({ available: true, passwordless: true, reason: '' })
  })

  it('names the user when sudo asks for a password', () => {
    expect(parseSudo('user=deploy\nsudo=password\n')).toEqual({ available: true, passwordless: false, reason: 'Needs passwordless sudo for deploy' })
  })

  it('says when sudo is not installed', () => {
    expect(parseSudo('user=root\nsudo=missing\n')).toEqual({ available: false, passwordless: false, reason: 'sudo is not installed on this server' })
  })
})
