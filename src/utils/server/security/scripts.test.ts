import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { securityArea } from '../areas/security'
import { PREFLIGHT_SCRIPT, armScript, backupScript, buildGuardedChange, disarmScript, revertNowScript, revertScript, type GuardContext, type GuardRequest } from './guard'
import { parseFail2ban } from './fail2ban'
import { parseHardening } from './hardening'
import { parseKeys } from './keys'
import { parseSsh } from './ssh'
import { parseUfw } from './ufw'

const syntaxError = (script: string): string => {
  const result = spawnSync('sh', ['-n'], { input: script, encoding: 'utf8' })
  return result.status === 0 ? '' : result.stderr
}

const fixture = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8')
const ok = <T>(data: T) => ({ status: 'ok' as const, data, at: 0 })

const ctx: GuardContext = { root: true, sshPort: 22, loginUser: 'deploy', socketActivated: true, ufwInstalled: true, dropIn: '', machine: 'abc', ufwRules: ['[ 2] 80/tcp                     ALLOW IN    Anywhere'] }

const requests: GuardRequest[] = [
  { kind: 'ufw.enable' },
  { kind: 'ufw.rule.add', rule: { port: '3306', proto: 'tcp', from: '10.0.0.0/8', action: 'allow', comment: 'MySQL (private)' } },
  { kind: 'ufw.rule.remove', rules: [{ number: 2, raw: ctx.ufwRules[0] }] },
  { kind: 'ufw.default', direction: 'incoming', policy: 'deny' },
  { kind: 'ssh.port', port: 2222 },
  { kind: 'ssh.password', enabled: false },
  { kind: 'ssh.rootLogin', value: 'prohibit-password' }
]

const facts: ServerFacts = {
  'security.ufw': ok(parseUfw(fixture('ufw-root.txt'))),
  'security.ssh': ok(parseSsh(fixture('ssh-root.txt'))),
  'security.keys': ok(parseKeys(fixture('keys-root.txt'))),
  'security.fail2ban': ok(parseFail2ban(fixture('fail2ban-running.txt'))),
  'security.hardening': ok({ ...parseHardening(fixture('hardening.txt')), swaps: [], ntpEnabled: false }),
  'security.timezones': ok(['Etc/UTC', 'Europe/Berlin'])
}

const actionParams: Record<string, unknown> = {
  'security.fail2ban.install': {},
  'security.fail2ban.configure': { bantime: 3600, findtime: 600, maxretry: 5 },
  'security.fail2ban.ignore': { ip: '203.0.113.7', op: 'add' },
  'security.fail2ban.unban': { ip: '192.0.2.44' },
  'security.ufw.install': {},
  'security.keys.add': { user: 'root', key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINew ops' },
  'security.keys.remove': { user: 'deploy', fingerprint: 'SHA256:Zz09222222222222222222222222222222222222mm1', protectedFingerprints: [] },
  'security.unattended': { enabled: true },
  'security.swap': { sizeGb: 2 },
  'security.timesync': {},
  'security.timezone': { timezone: 'Europe/Berlin' },
  'security.hostname': { hostname: 'web-2' }
}

describe('generated shell scripts parse with sh -n', () => {
  it.each(securityArea.probes.map((probe) => [probe.id, probe.script]))('probe %s', (_id, script) => {
    expect(syntaxError(script)).toBe('')
  })

  it('preflight', () => {
    expect(syntaxError(PREFLIGHT_SCRIPT)).toBe('')
  })

  it.each(requests.map((request) => [request.kind, request] as const))('guard %s', (_kind, request) => {
    const change = buildGuardedChange(request, ctx, true)
    for (const script of [change.apply, backupScript('abcdef01', change), revertScript('abcdef01', change), armScript('abcdef01'), disarmScript('abcdef01'), revertNowScript('abcdef01')]) {
      expect(syntaxError(script)).toBe('')
    }
  })

  it.each(securityArea.actions.map((action) => [action.type, action] as const))('action %s', (type, action) => {
    const plan = action.plan(action.validate(actionParams[type]), facts)
    for (const step of plan.steps.filter((candidate) => candidate.kind === 'command')) {
      expect(syntaxError(step.script)).toBe('')
      if (step.rollback) expect(syntaxError(step.rollback)).toBe('')
    }
  })
})
