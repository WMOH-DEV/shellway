import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { servicesAttention, SERVICE_ERROR_RANK } from './attention'
import { buildServiceList, filterCounts, filterServices, primaryVerb } from './list'
import { PROBE } from './probes'
import type { SystemdUnit } from './types'

const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 0 })

const unit = (name: string, active: string, sub: string, extra: Partial<SystemdUnit> = {}): SystemdUnit => ({ name, description: '', load: 'loaded', active, sub, enabled: true, cpuPercent: null, memoryBytes: null, sinceSeconds: null, ...extra })

const FACTS: ServerFacts = {
  [PROBE.systemd]: ok({ installed: true, units: [unit('nginx', 'active', 'running', { sinceSeconds: 2160000 }), unit('redis-server', 'failed', 'failed', { sinceSeconds: 120 }), unit('php8.2-fpm', 'inactive', 'dead', { enabled: false })] }),
  [PROBE.supervisor]: ok({ installed: true, running: true, programs: [{ name: 'queue', state: 'BACKOFF', pid: null, uptime: '', description: 'Exited too quickly', cpuPercent: null, memoryBytes: null }, { name: 'emails', state: 'RUNNING', pid: 1, uptime: '3:00:00', description: '', cpuPercent: 0.6, memoryBytes: 1 }] }),
  [PROBE.pm2]: ok({ installed: true, users: [{ user: 'deploy', running: true, startup: true, apps: [{ name: 'admin', id: 0, status: 'errored', restarts: 15, cpuPercent: null, memoryBytes: null, sinceSeconds: null, script: 'server.js', instances: 1 }] }] }),
  [PROBE.pm2Users]: ok({ installed: true, users: [{ user: 'deploy', running: true, startup: true, apps: [{ name: 'admin', id: 0, status: 'errored', restarts: 15, cpuPercent: null, memoryBytes: null, sinceSeconds: null, script: 'server.js', instances: 1 }] }] }),
  [PROBE.containers]: ok({ installed: true, access: 'direct', containers: [{ id: 'a', name: 'status-app', image: 'acme/status-page:1.4', state: 'running', status: 'Up 5 days', project: '', restartPolicy: 'always', cpuPercent: 0.8, memoryBytes: 2 }] })
}

describe('buildServiceList', () => {
  const items = buildServiceList(FACTS)

  it('puts failed items first, then groups by kind', () => {
    expect(items.map((item) => item.id)).toEqual(['systemd:redis-server', 'supervisor:queue', 'pm2:deploy:admin', 'systemd:nginx', 'systemd:php8.2-fpm', 'supervisor:emails', 'container:status-app'])
  })

  it('describes status in plain words', () => {
    const status = Object.fromEntries(items.map((item) => [item.id, item.statusText]))
    expect(status).toMatchObject({ 'systemd:redis-server': 'failed 2 min ago', 'systemd:nginx': 'running 25 d', 'systemd:php8.2-fpm': 'stopped', 'supervisor:queue': 'failed (backoff)', 'container:status-app': 'running 5 days' })
  })

  it('offers reload for nginx and start for stopped services', () => {
    const nginx = items.find((item) => item.name === 'nginx')
    const php = items.find((item) => item.name === 'php8.2-fpm')
    expect(nginx && primaryVerb(nginx)).toBe('reload')
    expect(nginx?.verbs).toEqual(['reload', 'restart', 'stop', 'disable'])
    expect(php && primaryVerb(php)).toBe('start')
    expect(php?.verbs).toEqual(['start', 'enable'])
  })

  it('filters by kind, failed and search text', () => {
    expect(filterCounts(items)).toEqual({ all: 7, failed: 3, systemd: 3, supervisor: 2, pm2: 1, container: 1 })
    expect(filterServices(items, 'failed', '').map((item) => item.name)).toEqual(['redis-server', 'queue', 'admin'])
    expect(filterServices(items, 'all', 'STATUS-page').map((item) => item.name)).toEqual(['status-app'])
  })

  it('is empty without facts', () => {
    expect(buildServiceList({})).toEqual([])
  })
})

describe('servicesAttention', () => {
  it('raises one error per failed unit, stopped program and errored pm2 app', () => {
    const items = servicesAttention(FACTS)
    expect(items.map((item) => item.id)).toEqual(['services:systemd:redis-server', 'services:supervisor:queue', 'services:pm2:deploy:admin'])
    expect(items.every((item) => item.level === 'error' && item.rank === SERVICE_ERROR_RANK)).toBe(true)
    expect(items[0].route).toEqual({ section: 'services', params: { id: 'systemd:redis-server' } })
  })

  it('ignores unavailable probes', () => {
    expect(servicesAttention({ [PROBE.supervisor]: { status: 'unavailable', reason: 'needs sudo', at: 0 } })).toEqual([])
  })
})
