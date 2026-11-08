import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import type { ActionDefinition, ServerFacts } from '@/types/server/core'
import { securityArea } from '../areas/security'
import { securityAttention } from './attention'
import { parseFail2ban } from './fail2ban'
import { jailContent, mergeIgnore, usesSystemdBackend } from './fail2banActions'
import { parseHardening } from './hardening'
import { fstabWithSwap, hostsWithHostname } from './hardeningActions'
import { assertPublicKey } from './keyActions'
import { parseKeys } from './keys'
import { parseSsh } from './ssh'
import { parseUfw } from './ufw'

const fixture = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8')
const ok = <T>(data: T) => ({ status: 'ok' as const, data, at: 0 })

const facts: ServerFacts = {
  'security.ufw': ok(parseUfw(fixture('ufw-root.txt'))),
  'security.ssh': ok(parseSsh(fixture('ssh-root.txt'))),
  'security.keys': ok(parseKeys(fixture('keys-root.txt'))),
  'security.fail2ban': ok(parseFail2ban(fixture('fail2ban-running.txt'))),
  'security.hardening': ok(parseHardening(fixture('hardening.txt'))),
  'security.timezones': ok(['Etc/UTC', 'Europe/Berlin'])
}

const action = (type: string): ActionDefinition => {
  const found = securityArea.actions.find((candidate) => candidate.type === type)
  if (!found) throw new Error(`missing ${type}`)
  return found
}

const plan = (type: string, raw: unknown, input: ServerFacts = facts) => {
  const definition = action(type)
  return definition.plan(definition.validate(raw), input)
}

const DEPLOY_KEY = 'SHA256:k3Jd1111111111111111111111111111111111119fQ'

describe('fail2ban actions', () => {
  it('merges the ignore list instead of replacing it', () => {
    expect(mergeIgnore(['127.0.0.1/8', '::1'], ['127.0.0.1/8', '198.51.100.0/24'], ['198.51.100.23', 'bad entry;'])).toEqual(['127.0.0.1/8', '::1', '198.51.100.0/24', '198.51.100.23'])
  })

  it('uses the systemd backend on Debian 12 and later only', () => {
    expect(usesSystemdBackend('debian', '12')).toBe(true)
    expect(usesSystemdBackend('debian', '11')).toBe(false)
    expect(usesSystemdBackend('ubuntu', '24.04')).toBe(false)
    expect(jailContent({ bantime: 3600, findtime: 600, maxretry: 5 }, ['127.0.0.1/8'], true)).toBe('[sshd]\nenabled = true\nbackend = systemd\nmaxretry = 5\nfindtime = 600\nbantime = 3600\nignoreip = 127.0.0.1/8\n')
  })

  it('adds an ignored IP to the existing list', () => {
    const result = plan('security.fail2ban.ignore', { ip: '203.0.113.7', op: 'add' })
    expect(result.blocked).toBeNull()
    expect(result.summary).toBe('ignoreip = 127.0.0.1/8 ::1 127.0.0.0/8 198.51.100.0/24 203.0.113.7')
    expect(result.steps[0]).toMatchObject({ kind: 'file-edit', root: true })
  })

  it('warns before removing your own IP from the ignore list', () => {
    const custom = { ...facts, 'security.fail2ban': ok({ ...parseFail2ban(fixture('fail2ban-running.txt')), clientIp: '198.51.100.0/24' }) }
    expect(plan('security.fail2ban.ignore', { ip: '198.51.100.0/24', op: 'remove' }, custom).warnings).toHaveLength(1)
  })

  it('unbans one address with a quoted command', () => {
    expect(plan('security.fail2ban.unban', { ip: '192.0.2.44' }).steps[0].script).toBe("fail2ban-client set sshd unbanip '192.0.2.44'")
    expect(() => action('security.fail2ban.unban').validate({ ip: '192.0.2.44; reboot' })).toThrow()
  })

  it('blocks install when fail2ban is already there', () => {
    expect(plan('security.fail2ban.install', {}).blocked?.kind).toBe('precondition')
  })
})

describe('key actions', () => {
  it('accepts one public key and rejects anything else', () => {
    expect(assertPublicKey('  ssh-ed25519   AAAAC3NzaC1lZDI1NTE5AAAAIExample  ci@example.com ')).toBe('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample ci@example.com')
    expect(() => assertPublicKey('command="reboot" ssh-ed25519 AAAA x')).toThrow()
    expect(() => assertPublicKey('ssh-ed25519 AAAA\nssh-rsa BBBB')).toThrow(/one key/)
    expect(() => assertPublicKey('-----BEGIN OPENSSH PRIVATE KEY-----')).toThrow()
  })

  it('refuses to remove the key this PC uses', () => {
    const result = plan('security.keys.remove', { user: 'deploy', fingerprint: DEPLOY_KEY, protectedFingerprints: [DEPLOY_KEY] })
    expect(result.blocked?.message).toMatch(/this PC/)
  })

  it('refuses to remove the last key while password login is off', () => {
    const ssh = parseSsh(fixture('ssh-root.txt'))
    const custom = { ...facts, 'security.ssh': ok({ ...ssh, effective: ssh.effective && { ...ssh.effective, passwordAuthentication: false } }) }
    const result = plan('security.keys.remove', { user: 'root', fingerprint: 'SHA256:k3Jd0000000000000000000000000000000000009fQ', protectedFingerprints: [] }, custom)
    expect(result.blocked?.message).toMatch(/last key/)
  })

  it('refuses to remove keys of the login user when this PC key could not be read', () => {
    const result = plan('security.keys.remove', { user: 'deploy', fingerprint: 'SHA256:Zz09222222222222222222222222222222222222mm1', protectedFingerprints: [], sessionKeyUnknown: true })
    expect(result.blocked?.message).toContain('could not read which key this PC logs in with')
  })

  it('removes another key by fingerprint as the login user without sudo', () => {
    const result = plan('security.keys.remove', { user: 'deploy', fingerprint: 'SHA256:Zz09222222222222222222222222222222222222mm1', protectedFingerprints: [DEPLOY_KEY] })
    expect(result.blocked).toBeNull()
    expect(result.steps[0]).toMatchObject({ root: false })
    expect(result.steps[0].script).toContain("F='/home/deploy/.ssh/authorized_keys'")
    expect(result.steps[0].rollback).toContain('.shellway-bak')
  })

  it('adds a key for another user with sudo and refuses duplicates', () => {
    const added = plan('security.keys.add', { user: 'root', key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINew ops' })
    expect(added.steps[0]).toMatchObject({ root: true })
    expect(added.steps[0].script).toContain('chown -h \'root\':"$(id -gn \'root\')"')
    expect(plan('security.keys.add', { user: 'root', key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeRootKey other' }).blocked?.message).toMatch(/already/)
  })
})

describe('hardening actions', () => {
  it('writes 20auto-upgrades when turning updates on or off', () => {
    const result = plan('security.unattended', { enabled: false })
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]).toMatchObject({ kind: 'file-edit' })
  })

  it('blocks a second swap file and checks free disk', () => {
    expect(plan('security.swap', { sizeGb: 2 }).blocked?.message).toMatch(/already on/)
    const hardening = parseHardening(fixture('hardening.txt'))
    const noSwap = { ...facts, 'security.hardening': ok({ ...hardening, swaps: [], rootFreeBytes: 2 * 1024 ** 3 }) }
    expect(plan('security.swap', { sizeGb: 4 }, noSwap).blocked?.message).toMatch(/disk space/)
    expect(plan('security.swap', { sizeGb: 1 }, noSwap).blocked).toBeNull()
    expect(() => action('security.swap').validate({ sizeGb: 3 })).toThrow()
  })

  it('edits fstab without duplicating the swap line', () => {
    expect(fstabWithSwap('UUID=a / ext4 defaults 0 1\n/swapfile none swap sw 0 0\n', true)).toBe('UUID=a / ext4 defaults 0 1\n/swapfile none swap sw 0 0\n')
    expect(fstabWithSwap('UUID=a / ext4 defaults 0 1\n/swapfile none swap sw 0 0\n', false)).toBe('UUID=a / ext4 defaults 0 1\n')
  })

  it('validates time zones against the server list', () => {
    expect(plan('security.timezone', { timezone: 'Europe/Berlin' }).blocked).toBeNull()
    expect(plan('security.timezone', { timezone: 'Mars/Olympus' }).blocked?.message).toMatch(/not a time zone/)
    expect(() => action('security.timezone').validate({ timezone: "Etc/UTC'; reboot" })).toThrow()
  })

  it('renames the host and its 127.0.1.1 line', () => {
    expect(hostsWithHostname('127.0.0.1 localhost\n127.0.1.1 web-1\n', 'app.example.com')).toBe('127.0.0.1 localhost\n127.0.1.1\tapp.example.com app\n')
    expect(hostsWithHostname('127.0.0.1 localhost\n', 'web-2')).toBe('127.0.0.1 localhost\n127.0.1.1\tweb-2\n')
    const result = plan('security.hostname', { hostname: 'web-2' })
    expect(result.steps.map((step) => step.id)).toEqual(['hostname', 'hosts'])
    expect(result.steps[0].rollback).toBe("hostnamectl set-hostname 'web-1'")
    expect(() => action('security.hostname').validate({ hostname: 'Web_1' })).toThrow()
  })
})

describe('security attention', () => {
  it('ranks the findings from the fixtures', () => {
    expect(securityAttention(facts).map((item) => [item.id, item.level, item.rank])).toEqual([
      ['security.weak-keys', 'warning', 55],
      ['security.password-login', 'info', 30]
    ])
  })

  it('flags an inactive firewall, root password login and missing fail2ban', () => {
    const ufw = parseUfw(fixture('ufw-nonroot.txt'))
    const ssh = parseSsh(fixture('ssh-root.txt'))
    const f2b = parseFail2ban('@@root\nyes\n@@installed\nno\n')
    const items = securityAttention({
      'security.ufw': ok(ufw),
      'security.ssh': ok({ ...ssh, effective: ssh.effective && { ...ssh.effective, permitRootLogin: 'yes' as const } }),
      'security.fail2ban': ok(f2b)
    })
    expect(items.map((item) => [item.id, item.rank])).toEqual([
      ['security.root-password', 75],
      ['security.ufw-off', 70],
      ['security.fail2ban-missing', 25]
    ])
    expect(items[0].route).toEqual({ section: 'security', params: { focus: 'ssh' } })
  })
})
