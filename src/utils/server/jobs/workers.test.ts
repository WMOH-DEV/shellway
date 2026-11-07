import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { jobsAttention, TASK_FAILED_RANK, WORKER_FAILING_RANK } from './attention'
import { shellwayCronLine } from './crontab'
import { parseCrontabs } from './crontabs'
import { PM2_STDOUT } from './fixtures/pm2'
import { SUPERVISOR_STDOUT } from './fixtures/supervisor'
import { parsePm2 } from './pm2'
import { parseSupervisor } from './supervisor'
import { buildWorkerRows, rootCauseSentence, supervisorUptime, workerLabel, workerRootCauses } from './workers'

const supervisor = parseSupervisor(SUPERVISOR_STDOUT)
const pm2 = parsePm2(PM2_STDOUT)
const NOW = 1_793_003_600_000

describe('workerLabel', () => {
  it.each([
    ['php artisan horizon', 'Horizon'],
    ['php artisan queue:work redis --sleep=3', 'Queue: default'],
    ['php artisan queue:work --queue=emails,default', 'Queue: emails'],
    ['node server.js', 'web']
  ])('%s → %s', (command, label) => {
    expect(workerLabel(command, 'web')).toBe(label)
  })
})

describe('supervisorUptime', () => {
  it.each([
    ['pid 1, uptime 2 days, 3:04:05', '2 d'],
    ['pid 1, uptime 1 day, 0:00:01', '1 d'],
    ['pid 1, uptime 3:04:05', '3 h'],
    ['pid 1, uptime 0:04:05', '4 min'],
    ['Not started', '']
  ])('%s → %s', (description, text) => {
    expect(supervisorUptime(description)).toBe(text)
  })
})

describe('buildWorkerRows', () => {
  const rows = buildWorkerRows(supervisor, pm2, NOW)

  it('merges Supervisor programs and pm2 apps with a health and detail', () => {
    expect(rows.map((row) => [row.key, row.label, row.health, row.detail, row.processes, row.editable])).toEqual([
      ['supervisor:shop-queue', 'Queue: default', 'failing', 'Crashing, restarting', 2, false],
      ['supervisor:horizon', 'Horizon', 'failing', 'Keeps crashing, gave up', 1, true],
      ['supervisor:legacy', 'legacy', 'stopped', 'Stopped', 1, false],
      ['pm2:deploy:admin', 'admin', 'running', 'Running 3 h', 2, false],
      ['pm2:root:bot', 'bot', 'failing', 'Crashed, 15 restarts', 1, false]
    ])
  })

  it('shows partial running state', () => {
    const facts = parseSupervisor('@@status\nweb:web_00 RUNNING pid 1, uptime 0:10:00\nweb:web_01 STOPPED Not started\n')
    expect(buildWorkerRows(facts, null, NOW)[0]).toMatchObject({ health: 'running', detail: '1 of 2 running 10 min' })
  })
})

describe('workerRootCauses', () => {
  it('blames a stopped Redis for failing Redis workers', () => {
    const causes = workerRootCauses(supervisor)
    expect(causes).toEqual([{ service: 'redis-server', label: 'Redis', state: 'inactive', workers: ['Queue: default', 'Horizon'], programs: ['shop-queue', 'horizon'] }])
    expect(rootCauseSentence(causes[0])).toBe('Queue: default and Horizon keep failing because Redis is stopped.')
  })

  it('does not blame a service that is running or not installed', () => {
    const running = { ...supervisor, services: { ...supervisor.services, 'redis-server': { load: 'loaded', active: 'active' } } }
    const missing = { ...supervisor, services: { ...supervisor.services, 'redis-server': { load: 'not-found', active: 'inactive' } } }
    expect(workerRootCauses(running)).toEqual([])
    expect(workerRootCauses(missing)).toEqual([])
  })

  it('follows a database queue to the database engine', () => {
    const facts = parseSupervisor(
      ['@@service mysql loaded failed', '@@status', 'jobs FATAL Exited too quickly', '@@file /etc/supervisor/conf.d/jobs.conf ab', '[program:jobs]', 'command=php artisan queue:work', 'directory=/srv/app', '', '@@end', '@@env database mysql /srv/app', ''].join('\n')
    )
    const [cause] = workerRootCauses(facts)
    expect(rootCauseSentence(cause)).toBe('Queue: default keeps failing because MySQL has failed.')
  })
})

describe('jobsAttention', () => {
  const ok = <T>(data: T) => ({ status: 'ok' as const, data, at: 0 })
  const failedTask = shellwayCronLine({ id: 'nightly', expression: '0 3 * * *', command: 'backup.sh', logOutput: false })
  const crontabs = parseCrontabs(`@@self deploy\n@@crontab deploy abc\n${failedTask}\n@@end\n@@last nightly shellway-exit 1 1793000000\n`)

  it('ranks failing workers as errors and failed tasks as warnings', () => {
    const facts: ServerFacts = { 'jobs.supervisor': ok(supervisor), 'jobs.pm2': ok(pm2), 'jobs.crontabs': ok(crontabs) }
    const items = jobsAttention(facts)
    expect(items.map((item) => [item.id, item.level, item.rank, item.title, item.detail])).toEqual([
      ['jobs.worker.supervisor:shop-queue', 'error', WORKER_FAILING_RANK, 'Queue: default keeps failing', 'Redis is not running'],
      ['jobs.worker.supervisor:horizon', 'error', WORKER_FAILING_RANK, 'Horizon keeps failing', 'Redis is not running'],
      ['jobs.worker.pm2:root:bot', 'error', WORKER_FAILING_RANK, 'bot keeps failing', 'Crashed, 15 restarts'],
      ['jobs.task.deploy.shellway:nightly', 'warning', TASK_FAILED_RANK, 'Scheduled task failed', 'Every day at 03:00 as deploy, exit code 1']
    ])
    expect(items.every((item) => item.route.section === 'jobs')).toBe(true)
  })

  it('is empty when nothing is known', () => {
    expect(jobsAttention({ 'jobs.supervisor': { status: 'unavailable', reason: 'no sudo', at: 0 } })).toEqual([])
  })
})
