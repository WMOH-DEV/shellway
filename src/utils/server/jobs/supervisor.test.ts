import { describe, expect, it } from 'vitest'
import { SHOP_CONF, SUPERVISOR_STDOUT } from './fixtures/supervisor'
import { parseStatus, parseSupervisor } from './supervisor'

describe('parseStatus', () => {
  it('reads process names, states and descriptions', () => {
    expect(parseStatus(['web   RUNNING   pid 1, uptime 0:01:00', 'garbage', 'x   WEIRD  y'])).toEqual([{ name: 'web', state: 'RUNNING', description: 'pid 1, uptime 0:01:00' }])
  })
})

describe('parseSupervisor', () => {
  const facts = parseSupervisor(SUPERVISOR_STDOUT)

  it('parses program blocks and attaches processes', () => {
    const shop = facts.programs.find((program) => program.name === 'shop-queue')
    expect(shop).toMatchObject({
      file: '/etc/supervisor/conf.d/shop.conf',
      command: 'php /var/www/shop/current/artisan queue:work redis --sleep=3 --tries=3',
      directory: '/var/www/shop/current',
      user: 'deploy',
      numprocs: 2,
      autostart: true,
      stdoutLogfile: '/var/www/shop/worker.log',
      shellway: false
    })
    expect(shop?.processes.map((process) => process.state)).toEqual(['RUNNING', 'BACKOFF'])
  })

  it('marks Shellway programs and keeps programs only known from status', () => {
    expect(facts.programs.find((program) => program.name === 'horizon')).toMatchObject({ shellway: true, processes: [{ state: 'FATAL' }] })
    expect(facts.programs.find((program) => program.name === 'legacy')).toMatchObject({ file: null, command: '', processes: [{ state: 'STOPPED' }] })
  })

  it('keeps file hashes, dependency services and app env', () => {
    expect(facts.files[0]).toMatchObject({ path: '/etc/supervisor/conf.d/shop.conf', sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' })
    expect(facts.files[0].content).toBe(SHOP_CONF)
    expect(facts.services['redis-server']).toEqual({ load: 'loaded', active: 'inactive' })
    expect(facts.appEnv['/var/www/shop/current']).toEqual({ queue: 'redis', db: 'mysql' })
    expect(facts.appEnv['/var/www/api/current']).toEqual({ queue: '', db: '' })
    expect(facts.running).toBe(true)
  })

  it('knows when supervisord is not running', () => {
    expect(parseSupervisor('@@status\nunix:///var/run/supervisor.sock no such file\n').running).toBe(false)
  })

  it('reports Supervisor as not installed', () => {
    expect(parseSupervisor('@@service redis-server loaded active\n@@missing\n')).toMatchObject({ installed: false, programs: [], services: { 'redis-server': { load: 'loaded', active: 'active' } } })
  })
})
