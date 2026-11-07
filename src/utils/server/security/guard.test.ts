import { describe, expect, it } from 'vitest'
import { GuardRefusal, backupScript, buildGuardedChange, disarmScript, guardPaths, mergeDropIn, revertScript, ufwRuleCommand, validateGuardRequest, type GuardContext } from './guard'

const ctx: GuardContext = {
  root: true,
  sshPort: 22,
  loginUser: 'deploy',
  socketActivated: false,
  ufwInstalled: true,
  dropIn: 'PermitRootLogin no\n',
  machine: 'abc',
  ufwRules: ['[ 1] 22/tcp                     ALLOW IN    Anywhere', '[ 2] 80/tcp                     ALLOW IN    Anywhere', '[ 3] 80/tcp (v6)                ALLOW IN    Anywhere (v6)']
}

describe('validateGuardRequest', () => {
  it('accepts a well formed rule', () => {
    expect(validateGuardRequest({ kind: 'ufw.rule.add', rule: { port: '3306', proto: 'tcp', from: '10.0.0.0/8', action: 'allow', comment: 'MySQL' } })).toEqual({
      kind: 'ufw.rule.add',
      rule: { port: '3306', proto: 'tcp', from: '10.0.0.0/8', action: 'allow', comment: 'MySQL' }
    })
  })

  it.each([
    [{ kind: 'ufw.rule.add', rule: { port: '80; rm -rf /', proto: 'tcp', from: 'any', action: 'allow', comment: '' } }],
    [{ kind: 'ufw.rule.add', rule: { port: '80', proto: 'tcp', from: 'evil.example.com', action: 'allow', comment: '' } }],
    [{ kind: 'ufw.rule.add', rule: { port: '80', proto: 'tcp', from: 'any', action: 'allow', comment: "x'; reboot" } }],
    [{ kind: 'ufw.rule.add', rule: { port: '8000:7000', proto: 'tcp', from: 'any', action: 'allow', comment: '' } }],
    [{ kind: 'ufw.rule.add', rule: { port: '8000:8100', proto: 'any', from: 'any', action: 'allow', comment: '' } }],
    [{ kind: 'ufw.rule.remove', rules: [{ number: 2, raw: '[ 1] 80/tcp ALLOW IN Anywhere' }] }],
    [{ kind: 'ssh.port', port: 70000 }],
    [{ kind: 'ssh.rootLogin', value: 'forced-commands-only' }],
    [{ kind: 'reboot' }]
  ])('rejects %j', (raw) => {
    expect(() => validateGuardRequest(raw)).toThrow()
  })
})

describe('buildGuardedChange', () => {
  it('builds the ufw command with the full rule syntax', () => {
    expect(ufwRuleCommand({ port: '8000:8100', proto: 'udp', from: '203.0.113.0/24', action: 'allow', comment: 'game' })).toBe("ufw allow proto udp from 203.0.113.0/24 to any port 8000:8100 comment 'game'")
    expect(ufwRuleCommand({ port: '443', proto: 'any', from: 'any', action: 'deny', comment: '' })).toBe('ufw deny from any to any port 443')
  })

  it('removes v4 and v6 rows from the highest number down after checking they did not move', () => {
    const change = buildGuardedChange({ kind: 'ufw.rule.remove', rules: [{ number: 2, raw: ctx.ufwRules[1] }, { number: 3, raw: ctx.ufwRules[2] }] }, ctx, true)
    expect(change.apply).toMatch(/grep -qxF '\[ 2\] 80\/tcp/)
    expect(change.apply.indexOf('ufw --force delete 3')).toBeLessThan(change.apply.indexOf('ufw --force delete 2'))
    expect(change.apply.indexOf('ufw --force delete 2')).toBeLessThan(change.apply.indexOf('ufw allow 22/tcp'))
  })

  it('refuses rules that changed since the page loaded', () => {
    expect(() => buildGuardedChange({ kind: 'ufw.rule.remove', rules: [{ number: 4, raw: '[ 4] 8080/tcp                   ALLOW IN    Anywhere' }] }, ctx, true)).toThrow(/changed/)
  })

  it('protects SSH allow rules and SSH denies', () => {
    expect(() => buildGuardedChange({ kind: 'ufw.rule.remove', rules: [{ number: 1, raw: ctx.ufwRules[0] }] }, ctx, true)).toThrow(GuardRefusal)
    expect(() => buildGuardedChange({ kind: 'ufw.rule.add', rule: { port: '22', proto: 'any', from: 'any', action: 'reject', comment: '' } }, ctx, true)).toThrow(/SSH port/)
    expect(() => buildGuardedChange({ kind: 'ufw.rule.add', rule: { port: '22', proto: 'udp', from: 'any', action: 'deny', comment: '' } }, ctx, true)).not.toThrow()
  })

  it('always allows SSH before a default deny', () => {
    const change = buildGuardedChange({ kind: 'ufw.default', direction: 'incoming', policy: 'deny' }, ctx, true)
    expect(change.apply).toContain('ufw allow 22/tcp\nufw default deny incoming')
  })

  it('writes the SSH drop-in, tests it and checks the effective value', () => {
    const change = buildGuardedChange({ kind: 'ssh.password', enabled: false }, ctx, true)
    expect(change.files).toEqual(['/etc/ssh/sshd_config.d/00-shellway.conf'])
    expect(change.apply).toContain('PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nSHELLWAY_EOF')
    expect(change.apply).toContain('"$SSHD" -t')
    expect(change.apply).toContain("grep -Eqx 'passwordauthentication no'")
    expect(change.apply).toContain('systemctl reload ssh 2>/dev/null || systemctl reload sshd')
  })

  it('restarts ssh.socket on socket activated systems', () => {
    const change = buildGuardedChange({ kind: 'ssh.port', port: 2222 }, { ...ctx, socketActivated: true }, true)
    expect(change.newPort).toBe(2222)
    expect(change.apply).toContain('ufw allow 2222/tcp')
    expect(change.apply).toContain('systemctl daemon-reload && systemctl restart ssh.socket')
    expect(change.revertTail).toContain('systemctl daemon-reload && systemctl restart ssh.socket')
    expect(change.files).toContain('/etc/ufw/user.rules')
  })

  it('refuses root login changes that would lock out the current root session', () => {
    expect(() => buildGuardedChange({ kind: 'ssh.rootLogin', value: 'no' }, { ...ctx, loginUser: 'root' }, true)).toThrow(/root/)
    expect(() => buildGuardedChange({ kind: 'ssh.rootLogin', value: 'prohibit-password' }, { ...ctx, loginUser: 'root' }, false)).toThrow(/key/)
  })
})

describe('mergeDropIn', () => {
  it('replaces managed settings case-insensitively and drops removed ones', () => {
    expect(mergeDropIn('port 22\nKbdInteractiveAuthentication no\nMaxAuthTries 3\n', { Port: '2222', KbdInteractiveAuthentication: null })).toBe('MaxAuthTries 3\nPort 2222\n')
  })
})

describe('guard scripts', () => {
  const change = buildGuardedChange({ kind: 'ufw.enable' }, ctx, true)

  it('backs up each file or records that it did not exist, and writes the revert script', () => {
    const script = backupScript('abcdef01', change)
    expect(script).toContain("backup 0 '/etc/ufw/user.rules'")
    expect(script).toContain('cat > /var/lib/shellway/revert-abcdef01.sh')
  })

  it('restores files, reloads and marks itself done', () => {
    const script = revertScript('abcdef01', change)
    expect(script).toContain("restore 3 '/etc/default/ufw'")
    expect(script).toContain('ufw reload; else ufw disable')
    expect(script.trim().endsWith('touch /var/lib/shellway/revert-abcdef01.done')).toBe(true)
  })

  it('disarms by stopping the timer and reports an undo that already ran', () => {
    const script = disarmScript('abcdef01')
    expect(script).toContain('systemctl stop shellway-revert-abcdef01.timer')
    expect(script).toContain('SHELLWAY_REVERTED=1')
  })

  it('rejects unsafe ids', () => {
    expect(() => guardPaths('../etc')).toThrow()
  })
})
