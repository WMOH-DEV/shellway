import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseFail2ban } from './fail2ban'
import { parseHardening, parseTimezones } from './hardening'
import { parseKeys } from './keys'
import { parseSsh } from './ssh'
import { groupUfwRules, parseUfw, parseUfwRule, ruleTargetsPort } from './ufw'

const fixture = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8')

describe('ufw probe', () => {
  const facts = parseUfw(fixture('ufw-root.txt'))

  it('reads status, defaults and the SSH port', () => {
    expect(facts).toMatchObject({ installed: true, root: true, active: true, sshPort: 22, dockerInstalled: true })
    expect(facts.defaults).toEqual({ incoming: 'deny', outgoing: 'allow', routed: 'disabled' })
  })

  it('parses numbered rules with comments, app profiles and v6 rows', () => {
    expect(facts.rules).toHaveLength(9)
    expect(facts.rules[3]).toMatchObject({ number: 4, to: '3306/tcp', action: 'allow', direction: 'in', from: '10.0.0.0/8', comment: 'MySQL from private network', v6: false })
    expect(facts.rules[4]).toMatchObject({ to: '6379/tcp', action: 'deny' })
    expect(facts.rules[5]).toMatchObject({ to: 'Nginx Full', from: 'Anywhere' })
    expect(facts.rules[6]).toMatchObject({ to: '22/tcp (v6)', v6: true, raw: '[ 7] 22/tcp (v6)                ALLOW IN    Anywhere (v6)' })
  })

  it('groups v4 and v6 rows and protects the SSH allow rule', () => {
    const groups = groupUfwRules(facts.rules, 22)
    expect(groups).toHaveLength(6)
    const ssh = groups.find((group) => group.to === '22/tcp')
    expect(ssh?.rules.map((rule) => rule.number)).toEqual([1, 7])
    expect(ssh?.protectedSsh).toBe(true)
    expect(groups.filter((group) => group.protectedSsh)).toHaveLength(1)
  })

  it('flags docker ports published on all interfaces', () => {
    expect(facts.published).toEqual([
      { container: 'cadvisor', binding: '127.0.0.1:8080->8080/tcp', publicBinding: false },
      { container: 'web', binding: '0.0.0.0:8081->80/tcp', publicBinding: true },
      { container: 'web', binding: '[::]:8081->80/tcp', publicBinding: true }
    ])
  })

  it('falls back to ufw.conf without root', () => {
    expect(parseUfw(fixture('ufw-nonroot.txt'))).toMatchObject({ root: false, active: false, enabledInConfig: false, rules: [], sshPort: 2222 })
  })

  it('matches ports, ranges and the OpenSSH profile', () => {
    expect(ruleTargetsPort('22', 22)).toBe(true)
    expect(ruleTargetsPort('20:30/tcp', 22)).toBe(true)
    expect(ruleTargetsPort('22/udp', 22)).toBe(false)
    expect(ruleTargetsPort('OpenSSH (v6)', 22)).toBe(true)
    expect(ruleTargetsPort('2222/tcp', 22)).toBe(false)
  })

  it('rejects lines that are not rules', () => {
    expect(parseUfwRule('Status: active')).toBeNull()
    expect(parseUfwRule('     --                         ------      ----')).toBeNull()
  })
})

describe('ssh probe', () => {
  const facts = parseSsh(fixture('ssh-root.txt'))

  it('reads effective settings from sshd -T', () => {
    expect(facts.effective).toEqual({
      ports: [22, 2222],
      passwordAuthentication: true,
      kbdInteractiveAuthentication: false,
      pubkeyAuthentication: true,
      permitRootLogin: 'prohibit-password',
      authenticationMethods: 'any'
    })
  })

  it('reads socket activation, drop-ins and the session', () => {
    expect(facts).toMatchObject({ root: true, socketActivated: true, includesDropIns: true, dropIns: ['50-cloud-init.conf', '00-shellway.conf'], sessionPort: 22, clientIp: '198.51.100.23' })
    expect(facts.shellwayDropIn?.content).toBe('PermitRootLogin prohibit-password\n')
  })

  it('reports no effective settings without root', () => {
    expect(parseSsh('@@root\nno\n@@effective\n@@socket\ninactive\n@@session\n198.51.100.23 1 203.0.113.10 22\n').effective).toBeNull()
  })
})

describe('keys probe', () => {
  const facts = parseKeys(fixture('keys-root.txt'))

  it('lists keys per user with type, bits and fingerprint', () => {
    expect(facts.loginUser).toBe('deploy')
    expect(facts.owners.map((owner) => [owner.user, owner.keys.length])).toEqual([['root', 1], ['deploy', 3]])
    expect(facts.owners[1].keys[0]).toMatchObject({ algorithm: 'ED25519', bits: 256, comment: 'deploy@laptop', weak: false, hasOptions: false })
  })

  it('flags short RSA and DSA keys as weak', () => {
    const [, rsa, dsa] = facts.owners[1].keys
    expect(rsa).toMatchObject({ algorithm: 'RSA', bits: 1024, comment: 'old-laptop', hasOptions: true, weak: true, weakReason: 'RSA 1024 is too short' })
    expect(dsa).toMatchObject({ algorithm: 'DSA', weak: true })
  })
})

describe('fail2ban probe', () => {
  const facts = parseFail2ban(fixture('fail2ban-running.txt'))

  it('reads jail status, ignore list and settings', () => {
    expect(facts).toMatchObject({ root: true, installed: true, running: true, jails: ['sshd'], clientIp: '198.51.100.23', osId: 'debian', osVersion: '12' })
    expect(facts.sshd).toMatchObject({ currentlyFailed: 2, totalBanned: 10, ignoreIp: ['127.0.0.0/8', '::1', '198.51.100.0/24'], bantime: 3600, findtime: 600, maxretry: 5 })
  })

  it('computes minutes left per ban', () => {
    expect(facts.sshd?.banned).toEqual([{ ip: '192.0.2.44', minutesLeft: 19 }, { ip: '192.0.2.198', minutesLeft: 38 }])
  })

  it('records an absent jail file', () => {
    expect(facts.jailFile).toEqual({ sha256: null, content: '' })
  })

  it('handles fail2ban not installed', () => {
    const missing = parseFail2ban('@@root\nyes\n@@installed\nno\n@@running\ninactive\n@@os\nubuntu\n24.04\n@@session\n198.51.100.23 1 203.0.113.10 22\n@@jail.sha\nabsent\n@@jail\n\n')
    expect(missing).toMatchObject({ installed: false, running: false, sshd: null, jails: [] })
  })
})

describe('hardening probe', () => {
  const facts = parseHardening(fixture('hardening.txt'))

  it('reads updates, reboot, swap, time and host name', () => {
    expect(facts).toMatchObject({
      unattendedInstalled: true,
      unattendedEnabled: true,
      updateListsEnabled: true,
      rebootRequired: true,
      rebootPackages: ['linux-image-6.8.0-45-generic'],
      swaps: [{ name: '/swapfile', type: 'file', sizeBytes: 2147483648 }],
      swappiness: 60,
      rootFreeBytes: 40000000000,
      ntpEnabled: true,
      canNtp: true,
      timezone: 'Etc/UTC',
      hostname: 'web-1'
    })
    expect(facts.hosts?.content).toBe('127.0.0.1 localhost\n127.0.1.1 web-1\n')
    expect(facts.memoryBytes).toBe(8123456 * 1024)
  })

  it('parses the time zone list', () => {
    expect(parseTimezones('Africa/Abidjan\nAmerica/Argentina/Buenos_Aires\nEtc/GMT+1\nUTC\n\n')).toEqual(['Africa/Abidjan', 'America/Argentina/Buenos_Aires', 'Etc/GMT+1', 'UTC'])
  })
})
