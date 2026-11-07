import { describe, expect, it, vi } from 'vitest'
import type { ActivityEntry } from '../../../src/types/server/core'
import type { GuardRequest, GuardRun } from '../../../src/utils/server/security/guard'
import { FakeRemoteExec, type FakeCall } from '../server/testing/FakeRemoteExec'
import { LockoutGuard, previewGuard, type FreshLogin } from './LockoutGuard'

const ID = 'abcdef0123456789'
const MACHINE = '0123456789abcdef0123456789abcdef'

const preflight = (overrides: { root?: boolean; port?: number; user?: string } = {}) =>
  [
    '@@root',
    overrides.root === false ? 'no' : 'yes',
    '@@session',
    `198.51.100.23 51234 203.0.113.10 ${overrides.port ?? 22}`,
    '@@user',
    overrides.user ?? 'deploy',
    '@@socket',
    'active',
    '@@ufw',
    'yes',
    '@@machine',
    MACHINE,
    '@@numbered',
    'Status: active',
    '[ 1] 22/tcp                     ALLOW IN    Anywhere',
    '[ 2] 80/tcp                     ALLOW IN    Anywhere',
    '@@dropin.sha',
    'absent',
    '@@dropin',
    ''
  ].join('\n')

type Script = 'preflight' | 'backup' | 'arm' | 'apply' | 'verify' | 'disarm' | 'revertNow' | 'cleanup'

function classify(call: FakeCall): Script {
  const stdin = call.stdin ?? ''
  if (stdin.includes('echo "@@session"')) return 'preflight'
  if (stdin.includes('SHELLWAY_BACKUP=ok')) return 'backup'
  if (stdin.includes('systemd-run --unit=')) return 'arm'
  if (stdin.includes('SHELLWAY_DISARMED=1')) return 'disarm'
  if (stdin.includes('SHELLWAY_REVERTED=1') && stdin.includes(`sh /var/lib/shellway/revert-${ID}.sh`)) return 'revertNow'
  if (stdin.startsWith('rm -rf')) return 'cleanup'
  return 'apply'
}

interface Scenario {
  preflight?: string
  arm?: { code: number; stdout: string }
  apply?: { code: number; stdout?: string; stderr?: string }
  disarmStdout?: string
  logins?: Array<string | Error>
  keyAuth?: boolean
}

function setup(scenario: Scenario = {}) {
  const fake = new FakeRemoteExec()
  fake.on((call) => classify(call) === 'preflight', { stdout: scenario.preflight ?? preflight() })
  fake.on((call) => classify(call) === 'backup', { stdout: 'SHELLWAY_BACKUP=ok\n' })
  fake.on((call) => classify(call) === 'arm', scenario.arm ?? { code: 0, stdout: 'SHELLWAY_ARMED=timer\n' })
  fake.on((call) => classify(call) === 'disarm', { stdout: scenario.disarmStdout ?? 'SHELLWAY_DISARMED=1\n' })
  fake.on((call) => classify(call) === 'revertNow', { stdout: 'SHELLWAY_REVERTED=1\n' })
  fake.on((call) => classify(call) === 'cleanup', { stdout: '' })
  fake.on((call) => classify(call) === 'apply', scenario.apply ?? { code: 0, stdout: 'Status: active\n' })
  const logins = [...(scenario.logins ?? [MACHINE])]
  const ports: number[] = []
  const login: FreshLogin = {
    run: async (port) => {
      ports.push(port)
      const next = logins.shift() ?? new Error('no more logins')
      if (next instanceof Error) throw next
      return `${next}\n`
    }
  }
  const updates: GuardRun[] = []
  const activity: ActivityEntry[] = []
  const sleep = vi.fn(async () => {})
  let clock = 1_000_000
  const guard = new LockoutGuard({
    exec: fake.exec,
    login,
    keyAuth: scenario.keyAuth ?? true,
    configPort: 22,
    connectionId: 'conn-1',
    sessionKey: 'session-1',
    newId: () => ID,
    onUpdate: (run) => updates.push(run),
    activity: { record: (entry) => activity.push(entry) },
    sleep,
    now: () => (clock += 1000)
  })
  const order = () => fake.calls.map(classify)
  return { fake, guard, ports, updates, activity, sleep, order }
}

const enable: GuardRequest = { kind: 'ufw.enable' }

describe('LockoutGuard', () => {
  it('backs up and arms the undo before applying, then verifies and disarms', async () => {
    const { guard, order, ports, activity } = setup()
    const run = await guard.execute(enable)
    expect(order()).toEqual(['preflight', 'backup', 'arm', 'apply', 'disarm'])
    expect(ports).toEqual([22])
    expect(run.outcome).toBe('done')
    expect(run.revertAt).toBeNull()
    expect(run.steps.map((step) => step.status)).toEqual(['done', 'done', 'done', 'done', 'done'])
    expect(activity).toHaveLength(1)
    expect(activity[0]).toMatchObject({ area: 'security', type: 'security.guard.ufw.enable', status: 'done', who: 'you', failure: null })
  })

  it('runs every server script as root and allows the SSH port before enabling ufw', async () => {
    const { guard, fake } = setup()
    await guard.execute(enable)
    const apply = fake.calls.find((call) => classify(call) === 'apply')
    expect(apply?.command).toContain('sudo -n sh -s')
    expect(apply?.stdin).toMatch(/ufw allow 22\/tcp\nufw --force enable/)
  })

  it('arms with a 60 second systemd timer and a sleep fallback', async () => {
    const { guard, fake } = setup()
    await guard.execute(enable)
    const arm = fake.calls.find((call) => classify(call) === 'arm')?.stdin ?? ''
    expect(arm).toContain(`systemd-run --unit=shellway-revert-${ID} --on-active=60 --timer-property=AccuracySec=1s /bin/sh /var/lib/shellway/revert-${ID}.sh`)
    expect(arm).toContain(`systemctl is-active --quiet shellway-revert-${ID}.timer`)
    expect(arm).toContain(`setsid nohup sh -c 'sleep 60; sh /var/lib/shellway/revert-${ID}.sh'`)
  })

  it('leaves the timer armed when the new connection fails, then checks access again', async () => {
    const { guard, order, updates, sleep, ports, activity } = setup({ logins: [new Error('Connection refused'), MACHINE] })
    const run = await guard.execute(enable)
    expect(order()).toEqual(['preflight', 'backup', 'arm', 'apply'])
    expect(updates.some((update) => update.outcome === 'reverting' && /undone automatically within \d+ s/.test(update.message))).toBe(true)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(ports).toEqual([22, 22])
    expect(run.outcome).toBe('reverted')
    expect(run.steps.find((step) => step.id === 'recheck')?.status).toBe('done')
    expect(activity[0]).toMatchObject({ status: 'failed' })
  })

  it('reports a lockout when access does not come back after the undo window', async () => {
    const { guard, order } = setup({ logins: [new Error('timeout'), new Error('timeout')] })
    const run = await guard.execute(enable)
    expect(order()).not.toContain('disarm')
    expect(run.outcome).toBe('locked')
  })

  it('treats a different server answering as a failed check', async () => {
    const { guard, order } = setup({ logins: ['ffffffffffffffffffffffffffffffff', MACHINE] })
    const run = await guard.execute(enable)
    expect(order()).not.toContain('disarm')
    expect(run.steps.find((step) => step.id === 'verify')?.status).toBe('failed')
    expect(run.outcome).toBe('reverted')
  })

  it('undoes right away when the change itself fails', async () => {
    const { guard, order, ports } = setup({ apply: { code: 1, stderr: 'ERROR: bad rule' } })
    const run = await guard.execute(enable)
    expect(order()).toEqual(['preflight', 'backup', 'arm', 'apply', 'revertNow', 'cleanup'])
    expect(ports).toEqual([])
    expect(run.outcome).toBe('reverted')
  })

  it('changes nothing when the undo cannot be armed', async () => {
    const { guard, order } = setup({ arm: { code: 1, stdout: '' } })
    const run = await guard.execute(enable)
    expect(order()).toEqual(['preflight', 'backup', 'arm', 'cleanup'])
    expect(run.outcome).toBe('failed')
    expect(run.message).toContain('Nothing was changed')
  })

  it('reports when the undo already ran before it could be cancelled', async () => {
    const { guard } = setup({ disarmStdout: 'SHELLWAY_REVERTED=1\nSHELLWAY_DISARMED=1\n' })
    expect((await guard.execute(enable)).outcome).toBe('reverted')
  })

  it('refuses to remove the SSH port rule before touching the server', async () => {
    const { guard, order } = setup()
    const run = await guard.execute({ kind: 'ufw.rule.remove', rules: [{ number: 1, raw: '[ 1] 22/tcp                     ALLOW IN    Anywhere' }] })
    expect(order()).toEqual(['preflight'])
    expect(run.outcome).toBe('failed')
    expect(run.message).toMatch(/protected/)
  })

  it('refuses to deny the SSH port', async () => {
    const { guard, order } = setup({ preflight: preflight({ port: 2222 }) })
    const run = await guard.execute({ kind: 'ufw.rule.add', rule: { port: '2000:3000', proto: 'tcp', from: 'any', action: 'deny', comment: '' } })
    expect(order()).toEqual(['preflight'])
    expect(run.message).toMatch(/2222 is your SSH port/)
  })

  it('refuses password login off when this session did not use a key', async () => {
    const { guard, order } = setup({ keyAuth: false })
    const run = await guard.execute({ kind: 'ssh.password', enabled: false })
    expect(order()).toEqual(['preflight'])
    expect(run.outcome).toBe('failed')
  })

  it('refuses without passwordless sudo', async () => {
    const { guard, order } = setup({ preflight: preflight({ root: false }) })
    const run = await guard.execute(enable)
    expect(order()).toEqual(['preflight'])
    expect(run.message).toMatch(/sudo/)
  })

  it('verifies a port change on the new port and rechecks on the old one', async () => {
    const { guard, ports } = setup({ logins: [new Error('refused'), MACHINE] })
    await guard.execute({ kind: 'ssh.port', port: 2222 })
    expect(ports).toEqual([2222, 22])
  })
})

describe('previewGuard', () => {
  it('shows the exact commands and the port it will check', async () => {
    const fake = new FakeRemoteExec().on('echo "@@session"', { stdout: preflight() })
    const preview = await previewGuard(fake.exec, { kind: 'ssh.port', port: 2222 }, true, 22)
    expect(preview.verifyPort).toBe(2222)
    expect(preview.commands).toContain('ufw allow 2222/tcp')
    expect(preview.commands).toContain('Port 2222')
    expect(preview.commands).toContain('systemctl daemon-reload && systemctl restart ssh.socket')
    expect(fake.calls).toHaveLength(1)
  })
})
