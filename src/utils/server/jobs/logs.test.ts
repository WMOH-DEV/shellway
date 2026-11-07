import { describe, expect, it } from 'vitest'
import { logTailScript, validateLogTarget } from './logs'

describe('validateLogTarget', () => {
  it('accepts known kinds with safe names', () => {
    expect(validateLogTarget({ kind: 'supervisor', process: 'shop-queue:shop-queue_00' })).toEqual({ kind: 'supervisor', process: 'shop-queue:shop-queue_00' })
    expect(validateLogTarget({ kind: 'pm2', user: 'deploy', app: 'admin' })).toEqual({ kind: 'pm2', user: 'deploy', app: 'admin' })
    expect(validateLogTarget({ kind: 'cron', id: 'nightly' })).toEqual({ kind: 'cron', id: 'nightly' })
  })

  it.each([
    [{ kind: 'file', path: '/etc/shadow' }],
    [{ kind: 'cron', id: '../../etc/shadow' }],
    [{ kind: 'supervisor', process: "x'; cat /etc/shadow" }],
    [{ kind: 'pm2', user: 'deploy', app: '$(id)' }],
    [null]
  ])('rejects %o', (raw) => {
    expect(() => validateLogTarget(raw)).toThrow()
  })
})

describe('logTailScript', () => {
  it('builds bounded tail commands', () => {
    expect(logTailScript({ kind: 'supervisor', process: 'web' })).toContain("$R supervisorctl tail -65536 'web' stdout 2>&1 | tail -c 65536")
    expect(logTailScript({ kind: 'cron', id: 'nightly' })).toContain('$R tail -c 65536 /var/log/shellway/cron-nightly.log')
    expect(logTailScript({ kind: 'pm2', user: 'deploy', app: 'admin' })).toContain("sudo -n -u 'deploy' -H pm2 logs 'admin' --nostream --raw --lines 200")
  })
})
