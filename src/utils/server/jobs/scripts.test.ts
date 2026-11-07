import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { cronRemoveAction, cronRunNowAction, cronSaveAction } from './cronActions'
import { parseCrontabs } from './crontabs'
import { logTailScript } from './logs'
import { jobsProbes } from './probes'
import { parseSupervisor } from './supervisor'
import { SUPERVISOR_STDOUT } from './fixtures/supervisor'
import { parseUsers } from './users'
import { pm2ControlAction, workerControlAction, workerRemoveAction } from './workerActions'

const checkSyntax = (script: string): void => {
  execFileSync('sh', ['-n'], { input: script })
}

const ok = <T>(data: T) => ({ status: 'ok' as const, data, at: 0 })
const facts = {
  'jobs.supervisor': ok(parseSupervisor(SUPERVISOR_STDOUT)),
  'jobs.crontabs': ok(parseCrontabs('@@self deploy\n@@crontab deploy abc\n* * * * * true\n@@end\n@@others yes\n')),
  'jobs.users': ok(parseUsers('@@self deploy\n@@sudo yes\n@@user root 0 /root\n@@user deploy 1000 /home/deploy\n')),
  'jobs.pm2': ok({ installed: true, users: ['root'], apps: [{ user: 'root', name: 'bot', status: 'online', instances: 1, restarts: 0, startedAt: null, cwd: '', script: '', args: '' }] })
}

describe('shell syntax', () => {
  it.each(jobsProbes.map((probe) => [probe.id, probe.script]))('probe %s parses', (_id, script) => {
    expect(() => checkSyntax(script)).not.toThrow()
  })

  it('action and log scripts parse', () => {
    const plans = [
      cronSaveAction.plan({ user: 'deploy', ref: 'line:0', id: 'x-1', expression: '*/5 * * * *', command: "echo 'it''s' && date +%s", logOutput: true }, facts),
      cronSaveAction.plan({ user: 'root', ref: null, id: 'x-2', expression: '@daily', command: 'true', logOutput: false }, facts),
      cronRemoveAction.plan({ user: 'deploy', ref: 'line:0' }, facts),
      cronRunNowAction.plan({ user: 'root', command: "printf '%s\\n' \"$HOME\"" }, facts),
      workerRemoveAction.plan({ name: 'horizon' }, facts),
      workerControlAction.plan({ name: 'shop-queue', op: 'stop' }, facts),
      pm2ControlAction.plan({ user: 'root', name: 'bot', op: 'restart' }, facts)
    ]
    for (const plan of plans) {
      expect(plan.blocked).toBeNull()
      for (const step of plan.steps) {
        checkSyntax(step.script)
        if (step.rollback) checkSyntax(step.rollback)
      }
    }
    for (const target of [{ kind: 'supervisor' as const, process: 'a:a_00' }, { kind: 'pm2' as const, user: 'deploy', app: 'web' }, { kind: 'cron' as const, id: 'x-1' }]) checkSyntax(logTailScript(target))
  })
})
