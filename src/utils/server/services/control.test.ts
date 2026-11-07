import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { planControl, validateControl } from './control'
import { planFix, validateFix } from './fix'
import { PROBE } from './probes'

const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 0 })

const FACTS: ServerFacts = {
  [PROBE.pm2]: ok({ installed: true, users: [{ user: 'deploy', running: true, startup: true, apps: [] }] }),
  [PROBE.containers]: ok({ installed: true, access: 'direct', containers: [] })
}

describe('validateControl', () => {
  it.each([
    { kind: 'systemd', name: 'nginx', verb: 'reload' },
    { kind: 'systemd', name: 'php8.3-fpm', verb: 'enable' },
    { kind: 'supervisor', name: 'shop-queue:default_00', verb: 'restart' },
    { kind: 'pm2', name: 'admin', verb: 'stop', user: 'deploy' },
    { kind: 'container', name: 'status-app', verb: 'start' }
  ])('accepts %j', (raw) => {
    expect(validateControl(raw)).toEqual({ user: null, ...raw })
  })

  it.each([
    [null, 'Invalid service action'],
    [{ kind: 'toString', name: 'nginx', verb: 'start' }, 'Invalid service kind'],
    [{ kind: 'systemd', name: 'nginx; rm -rf /', verb: 'start' }, 'Invalid service name'],
    [{ kind: 'systemd', name: '-nginx', verb: 'start' }, 'Invalid service name'],
    [{ kind: 'systemd', name: 'nginx', verb: 'mask' }, 'Invalid service action'],
    [{ kind: 'supervisor', name: 'worker', verb: 'reload' }, 'Invalid service action'],
    [{ kind: 'pm2', name: 'admin', verb: 'restart' }, 'Invalid user'],
    [{ kind: 'pm2', name: 'admin', verb: 'restart', user: 'root$(id)' }, 'Invalid user'],
    [{ kind: 'container', name: '$(reboot)', verb: 'stop' }, 'Invalid service name']
  ])('rejects %j', (raw, message) => {
    expect(() => validateControl(raw)).toThrow(message)
  })
})

describe('planControl', () => {
  it('tests the nginx config before reloading', () => {
    const plan = planControl({ kind: 'systemd', name: 'nginx', verb: 'reload', user: null }, {})
    expect(plan.steps[0]).toMatchObject({ root: true, display: "nginx -t\nsystemctl reload 'nginx.service'" })
    expect(plan.blocked).toBeNull()
  })

  it('blocks stopping SSH', () => {
    expect(planControl({ kind: 'systemd', name: 'ssh', verb: 'stop', user: null }, {}).blocked?.kind).toBe('precondition')
    expect(planControl({ kind: 'systemd', name: 'ssh', verb: 'restart', user: null }, {}).blocked).toBeNull()
  })

  it('runs supervisorctl as root', () => {
    expect(planControl({ kind: 'supervisor', name: 'worker', verb: 'restart', user: null }, {}).steps[0]).toMatchObject({ root: true, script: "supervisorctl restart 'worker'" })
  })

  it('runs pm2 as the login user without sudo', () => {
    const step = planControl({ kind: 'pm2', name: 'admin', verb: 'restart', user: 'deploy' }, FACTS).steps[0]
    expect(step.root).toBe(false)
    expect(step.display).toBe("pm2 restart 'admin'")
  })

  it('runs pm2 of another user through sudo -n -u', () => {
    const step = planControl({ kind: 'pm2', name: 'api', verb: 'stop', user: 'app' }, FACTS).steps[0]
    expect(step.root).toBe(true)
    expect(step.script).toMatch(/^sudo -n -u app -H sh -c /)
    expect(step.display).toBe("sudo -n -u app pm2 stop 'api'")
  })

  it('uses root for docker only without group access', () => {
    expect(planControl({ kind: 'container', name: 'web', verb: 'restart', user: null }, FACTS).steps[0].root).toBe(false)
    const denied = { [PROBE.containers]: ok({ installed: true, access: null, containers: [] }) }
    const plan = planControl({ kind: 'container', name: 'web', verb: 'restart', user: null }, denied)
    expect(plan.steps[0].root).toBe(true)
    expect(plan.blocked?.kind).toBe('sudo')
  })

  it('warns before a stop', () => {
    expect(planControl({ kind: 'systemd', name: 'mysql', verb: 'stop', user: null }, {}).warnings).toHaveLength(1)
  })
})

describe('services.fix', () => {
  it('validates the fix id and unit', () => {
    expect(validateFix({ fix: 'redis-log-owner', unit: 'redis-server' })).toEqual({ fix: 'redis-log-owner', unit: 'redis-server' })
    expect(() => validateFix({ fix: 'rm', unit: 'redis-server' })).toThrow('Unknown fix')
    expect(() => validateFix({ fix: 'redis-log-owner', unit: 'nginx' })).toThrow('Invalid service name')
  })

  it('chowns the log file, then starts redis', () => {
    const plan = planFix({ fix: 'redis-log-owner', unit: 'redis-server' })
    expect(plan.steps.map((step) => step.id)).toEqual(['own-log', 'start'])
    expect(plan.steps[0].display).toContain('chown -h redis:redis /var/log/redis/redis-server.log')
    expect(plan.steps[1].script).toContain('systemctl start redis-server.service')
  })
})
