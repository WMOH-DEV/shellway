import { describe, expect, it, vi } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import type { FileEditSpec } from '@/utils/server/fileEdit'
import { PM2_STDOUT } from './fixtures/pm2'
import { SUPERVISOR_STDOUT } from './fixtures/supervisor'
import { parsePm2 } from './pm2'
import { parseSupervisor } from './supervisor'
import { parseUsers } from './users'
import { pm2ControlAction, supervisorConf, workerControlAction, workerRemoveAction, workerSaveAction } from './workerActions'

const specs = vi.hoisted(() => [] as FileEditSpec[])

vi.mock('@/utils/server/fileEdit', () => ({
  EXIT_FILE_CHANGED: 74,
  fileEditStep: (spec: FileEditSpec) => {
    specs.push(spec)
    return { id: spec.id, label: spec.label, kind: 'file-edit', root: true, script: '', display: spec.path, diff: spec.diff, timeoutSeconds: 60 }
  }
}))

const ok = <T>(data: T) => ({ status: 'ok' as const, data, at: 0 })
const users = parseUsers('@@self deploy\n@@sudo yes\n@@user root 0 /root\n@@user deploy 1000 /home/deploy\n')
const facts: ServerFacts = {
  'jobs.supervisor': ok(parseSupervisor(SUPERVISOR_STDOUT)),
  'jobs.pm2': ok(parsePm2(PM2_STDOUT)),
  'jobs.users': ok(users)
}

const worker = { name: 'shop-emails', command: 'php artisan queue:work --sleep=3 --tries=3 --max-time=3600', directory: '/var/www/shop/current', user: 'deploy', numprocs: 2, autostart: true }

describe('jobs.worker-save', () => {
  it('validates every field', () => {
    expect(workerSaveAction.validate(worker)).toEqual(worker)
    expect(() => workerSaveAction.validate({ ...worker, name: 'Bad Name' })).toThrow('worker name')
    expect(() => workerSaveAction.validate({ ...worker, command: 'a\nb' })).toThrow('one line')
    expect(() => workerSaveAction.validate({ ...worker, command: '  ' })).toThrow('Enter a command')
    expect(() => workerSaveAction.validate({ ...worker, command: 'run ; rm -rf /' })).toThrow('comment')
    expect(() => workerSaveAction.validate({ ...worker, directory: '/var/www/../etc' })).toThrow('folder')
    expect(() => workerSaveAction.validate({ ...worker, user: 'Root;' })).toThrow('user')
    expect(() => workerSaveAction.validate({ ...worker, numprocs: 0 })).toThrow('numprocs')
    expect(() => workerSaveAction.validate({ ...worker, autostart: 'yes' })).toThrow('autostart')
  })

  it('writes a Supervisor program with Laravel defaults', () => {
    expect(supervisorConf({ ...worker, command: 'php -r "printf(\'%d\', 1);"' })).toBe(
      [
        '[program:shop-emails]',
        'process_name=%(program_name)s_%(process_num)02d',
        'command=php -r "printf(\'%%d\', 1);"',
        'directory=/var/www/shop/current',
        'user=deploy',
        'numprocs=2',
        'autostart=true',
        'autorestart=true',
        'stopasgroup=true',
        'killasgroup=true',
        'redirect_stderr=true',
        'stdout_logfile=/var/log/supervisor/shellway-shop-emails.log',
        'stopwaitsecs=3600',
        ''
      ].join('\n')
    )
  })

  it('plans a checked file edit tested with reread and applied with update', () => {
    specs.length = 0
    const plan = workerSaveAction.plan(worker, facts)
    expect(plan.blocked).toBeNull()
    expect(plan.title).toBe('Add worker shop-emails')
    expect(specs[0]).toMatchObject({ path: '/etc/supervisor/conf.d/shellway-shop-emails.conf', originalSha256: null, test: 'supervisorctl reread', reload: 'supervisorctl update', mode: '0644' })
  })

  it('edits an existing Shellway worker against the hash it read', () => {
    specs.length = 0
    const plan = workerSaveAction.plan({ ...worker, name: 'horizon', command: 'php artisan horizon' }, facts)
    expect(plan.title).toBe('Update worker horizon')
    expect(specs[0].originalSha256).toBe('a'.repeat(64))
    expect(specs[0].diff).toContain('  command=php artisan horizon')
    expect(specs[0].diff).toContain('- directory=/var/www/api/current')
    expect(specs[0].diff).toContain('+ numprocs=2')
  })

  it('blocks a name already used outside Shellway, unknown users and missing Supervisor', () => {
    expect(workerSaveAction.plan({ ...worker, name: 'shop-queue' }, facts).blocked?.message).toContain('/etc/supervisor/conf.d/shop.conf')
    expect(workerSaveAction.plan({ ...worker, user: 'nobody' }, facts).blocked?.message).toContain('does not exist')
    expect(workerSaveAction.plan(worker, { ...facts, 'jobs.supervisor': ok(parseSupervisor('@@missing\n')) }).blocked?.message).toContain('not installed')
    expect(workerSaveAction.plan(worker, {}).blocked).not.toBeNull()
  })
})

describe('jobs.worker-remove', () => {
  it('backs up, stops and removes only Shellway configs, then updates Supervisor', () => {
    const plan = workerRemoveAction.plan({ name: 'horizon' }, facts)
    expect(plan.steps.map((step) => step.id)).toEqual(['remove-config', 'update'])
    const [remove] = plan.steps
    expect(remove.script).toContain(`!= '${'a'.repeat(64)}' ]; then`)
    expect(remove.script).toContain('exit 74')
    expect(remove.script).toContain("supervisorctl stop 'horizon:*'")
    expect(remove.script).toContain('SHELLWAY_STATE backup=')
    expect(remove.rollback).toContain('cp "$backup" \'/etc/supervisor/conf.d/shellway-horizon.conf\'')
    expect(remove.cleanExits).toEqual([74])
    expect(workerRemoveAction.plan({ name: 'shop-queue' }, facts).blocked?.message).toContain('only remove workers it created')
  })
})

describe('jobs.worker-control', () => {
  it('controls every process of a known program', () => {
    const plan = workerControlAction.plan(workerControlAction.validate({ name: 'shop-queue', op: 'restart' }), facts)
    expect(plan.steps[0]).toMatchObject({ root: true, script: "supervisorctl restart 'shop-queue:*'", display: "supervisorctl restart 'shop-queue:*'" })
    expect(() => workerControlAction.validate({ name: 'x', op: 'kill' })).toThrow('op must be one of')
    expect(workerControlAction.plan({ name: 'ghost', op: 'start' }, facts).blocked).not.toBeNull()
  })
})

describe('jobs.pm2-control', () => {
  it('runs pm2 as the login user directly and as other users through sudo -n', () => {
    expect(pm2ControlAction.plan({ user: 'deploy', name: 'admin', op: 'restart' }, facts).steps[0]).toMatchObject({ root: false, script: "pm2 restart 'admin'" })
    expect(pm2ControlAction.plan({ user: 'root', name: 'bot', op: 'stop' }, facts).steps[0]).toMatchObject({ root: true, script: "sudo -n -u 'root' -H pm2 stop 'bot'" })
    expect(pm2ControlAction.plan({ user: 'deploy', name: 'bot', op: 'stop' }, facts).blocked).not.toBeNull()
  })
})
