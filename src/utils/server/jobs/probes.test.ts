import { describe, expect, it } from 'vitest'
import { PM2_STDOUT } from './fixtures/pm2'
import { parsePm2 } from './pm2'
import { jobsProbes } from './probes'
import { parseTimers } from './timers'
import { parseUsers } from './users'

describe('parsePm2', () => {
  const facts = parsePm2(PM2_STDOUT)

  it('groups instances per user and app and drops the env', () => {
    expect(facts.users).toEqual(['deploy', 'root', 'www-data'])
    expect(facts.apps).toEqual([
      { user: 'deploy', name: 'admin', status: 'online', instances: 2, restarts: 3, startedAt: 1_792_990_000_000, cwd: '/var/www/admin/current', script: '/var/www/admin/current/dist/server.js', args: '--port 3000' },
      { user: 'root', name: 'bot', status: 'errored', instances: 1, restarts: 15, startedAt: null, cwd: '/opt/bot', script: '/opt/bot/index.js', args: '' }
    ])
    expect(JSON.stringify(facts)).not.toContain('secret-value')
  })

  it('reports pm2 as not installed', () => {
    expect(parsePm2('@@missing\n')).toEqual({ installed: false, users: [], apps: [] })
  })

  it('ignores output that is not JSON', () => {
    expect(parsePm2('@@pm2 deploy\n[oops\n@@end\n').apps).toEqual([])
  })
})

describe('parseTimers', () => {
  it('reads systemctl show blocks', () => {
    const stdout = [
      'Id=certbot.timer',
      'Description=Run certbot twice daily',
      'Unit=certbot.service',
      'NextElapseUSecRealtime=Sat 2026-11-07 12:13:00 UTC',
      'LastTriggerUSec=Sat 2026-11-07 00:13:00 UTC',
      'ActiveState=active',
      '',
      'Id=fstrim.timer',
      'Description=Discard unused blocks once a week',
      'Unit=fstrim.service',
      'NextElapseUSecRealtime=',
      'LastTriggerUSec=n/a',
      'ActiveState=inactive',
      ''
    ].join('\n')
    expect(parseTimers(stdout)).toEqual({
      available: true,
      timers: [
        { unit: 'certbot.timer', description: 'Run certbot twice daily', activates: 'certbot.service', next: 'Sat 2026-11-07 12:13:00 UTC', last: 'Sat 2026-11-07 00:13:00 UTC', active: 'active' },
        { unit: 'fstrim.timer', description: 'Discard unused blocks once a week', activates: 'fstrim.service', next: '', last: '', active: 'inactive' }
      ]
    })
  })

  it('reports systemd as unavailable', () => {
    expect(parseTimers('@@missing\n')).toEqual({ available: false, timers: [] })
  })
})

describe('parseUsers', () => {
  it('reads self, sudo and users', () => {
    expect(parseUsers('@@self deploy\n@@sudo yes\n@@user root 0 /root\n@@user www-data 33 /var/www\n@@user deploy 1000 /home/deploy\n')).toEqual({
      self: 'deploy',
      sudo: true,
      users: [
        { name: 'root', uid: 0, home: '/root' },
        { name: 'www-data', uid: 33, home: '/var/www' },
        { name: 'deploy', uid: 1000, home: '/home/deploy' }
      ]
    })
  })
})

describe('jobsProbes', () => {
  it('declares one probe per id, all in the jobs area, root only for Supervisor', () => {
    expect(jobsProbes.map((probe) => [probe.id, probe.root])).toEqual([
      ['jobs.supervisor', true],
      ['jobs.pm2', false],
      ['jobs.crontabs', false],
      ['jobs.timers', false],
      ['jobs.users', false]
    ])
    expect(jobsProbes.every((probe) => probe.area === 'jobs')).toBe(true)
  })

  it('never uses plain sudo', () => {
    for (const probe of jobsProbes) expect(probe.script).not.toMatch(/(^|[\s;|&(])sudo (?!-n)/m)
  })
})
