import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { cronRemoveAction, cronRunNowAction, cronSaveAction } from './cronActions'
import { shellwayCronLine } from './crontab'
import { parseCrontabs } from './crontabs'
import { parseUsers } from './users'

const ok = <T>(data: T) => ({ status: 'ok' as const, data, at: 0 })
const SHA = 'f'.repeat(64)
const existing = shellwayCronLine({ id: 'nightly', expression: '0 3 * * *', command: 'backup.sh', logOutput: true })
const crontabText = `MAILTO=""\n* * * * * cd /var/www/shop/current && php artisan schedule:run >> /dev/null 2>&1\n${existing}\n`

function factsFor(others: boolean): ServerFacts {
  const crontabs = parseCrontabs(['@@self deploy', `@@crontab deploy ${SHA}`, crontabText, '@@end', `@@others ${others ? 'yes' : 'no'}`, ''].join('\n'))
  const users = parseUsers('@@self deploy\n@@sudo yes\n@@user root 0 /root\n@@user www-data 33 /var/www\n@@user deploy 1000 /home/deploy\n')
  return { 'jobs.crontabs': ok(crontabs), 'jobs.users': ok(users) }
}

const facts = factsFor(true)
const task = { user: 'deploy', ref: null, id: 'reports-a1b2', expression: '30 6 * * *', command: 'cd /var/www/api/current && php artisan reports:daily', logOutput: true }

describe('jobs.cron-save validation', () => {
  it('accepts a clean task', () => {
    expect(cronSaveAction.validate(task)).toEqual(task)
    expect(cronSaveAction.validate({ ...task, expression: '  @daily ' }).expression).toBe('@daily')
  })

  it.each([
    [{ expression: '61 * * * *' }, 'minute'],
    [{ expression: '* * * * * rm' }, '5 parts'],
    [{ expression: '* * * * *\n' }, 'schedule is not valid'],
    [{ command: 'echo a\necho b' }, 'one line'],
    [{ command: '' }, 'Enter a command'],
    [{ command: 'run.sh # note' }, '# comment'],
    [{ user: 'Deploy User' }, 'user'],
    [{ id: 'Bad_ID' }, 'task id'],
    [{ ref: 'shellway:other' }, 'does not match'],
    [{ ref: 'line:x' }, 'task'],
    [{ logOutput: 'yes' }, 'logOutput']
  ])('rejects %o', (patch, message) => {
    expect(() => cronSaveAction.validate({ ...task, ...patch })).toThrow(message)
  })
})

describe('jobs.cron-save plan', () => {
  it('appends a tagged line after checking the crontab did not change', () => {
    const plan = cronSaveAction.plan(task, facts)
    expect(plan.blocked).toBeNull()
    expect(plan.summary).toContain('Every day at 06:30')
    const [log, install] = plan.steps
    expect(log).toMatchObject({ id: 'prepare-log', root: true })
    expect(log.script).toContain("chown 'deploy': /var/log/shellway/cron-reports-a1b2.log")
    expect(install).toMatchObject({ id: 'install-crontab', root: false, display: 'crontab -', cleanExits: [74] })
    expect(install.script).toContain(`current=$(crontab -l 2>/dev/null | sha256sum | cut -c1-64)`)
    expect(install.script).toContain(`if [ "$current" != '${SHA}' ]; then`)
    expect(install.script).toContain(`crontab - <<'SHELLWAY_CRONTAB_EOF'\n${crontabText}${shellwayCronLine(task)}\nSHELLWAY_CRONTAB_EOF\n`)
    expect(install.diff).toBe(`+ ${shellwayCronLine(task)}`)
  })

  it('replaces an existing Shellway task in place', () => {
    const plan = cronSaveAction.plan({ ...task, ref: 'shellway:nightly', id: 'nightly', expression: '0 4 * * *', command: 'backup.sh' }, facts)
    const install = plan.steps[1]
    expect(install.diff).toBe(`- ${existing}\n+ ${shellwayCronLine({ id: 'nightly', expression: '0 4 * * *', command: 'backup.sh', logOutput: true })}`)
    expect(install.script).not.toContain('0 3 * * *')
  })

  it('takes over a plain crontab line', () => {
    const plan = cronSaveAction.plan({ ...task, ref: 'line:1' }, facts)
    expect(plan.steps[1].script).not.toContain('schedule:run')
    expect(plan.steps[1].diff).toContain('- * * * * * cd /var/www/shop/current')
  })

  it('writes the crontab of another user as root, starting from an empty one', () => {
    const plan = cronSaveAction.plan({ ...task, user: 'www-data' }, facts)
    const install = plan.steps[1]
    expect(install.root).toBe(true)
    expect(install.display).toBe("crontab -u 'www-data' -")
    expect(install.script).toContain("crontab -u 'www-data' -l 2>/dev/null")
    expect(install.script).toContain("'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'")
  })

  it('blocks unknown users, missing sudo and stale refs', () => {
    expect(cronSaveAction.plan({ ...task, user: 'ghost' }, facts).blocked?.message).toContain('does not exist')
    expect(cronSaveAction.plan({ ...task, user: 'root' }, factsFor(false)).blocked?.message).toContain('passwordless sudo')
    expect(cronSaveAction.plan({ ...task, ref: 'line:40' }, facts).blocked?.message).toContain('no longer in the crontab')
    expect(cronSaveAction.plan(task, {}).blocked).not.toBeNull()
  })
})

describe('jobs.cron-remove', () => {
  it('removes one line with the same compare-and-swap check', () => {
    const plan = cronRemoveAction.plan(cronRemoveAction.validate({ user: 'deploy', ref: 'shellway:nightly' }), facts)
    const [install] = plan.steps
    expect(install.diff).toBe(`- ${existing}`)
    expect(install.script).toContain(`<<'SHELLWAY_CRONTAB_EOF'\nMAILTO=""\n* * * * * cd /var/www/shop/current && php artisan schedule:run >> /dev/null 2>&1\nSHELLWAY_CRONTAB_EOF`)
    expect(cronRemoveAction.plan({ user: 'deploy', ref: 'line:0' }, facts).blocked).not.toBeNull()
  })
})

describe('jobs.cron-run-now', () => {
  it('runs as the login user without sudo and detached', () => {
    const plan = cronRunNowAction.plan(cronRunNowAction.validate({ user: 'deploy', command: "echo 'hi'" }), facts)
    expect(plan.steps[0]).toMatchObject({ root: false, detached: true, script: `cd "$HOME" && sh -c 'echo '\\''hi'\\'''` })
  })

  it('runs as another user through sudo -n', () => {
    const plan = cronRunNowAction.plan({ user: 'www-data', command: 'php artisan schedule:run' }, facts)
    expect(plan.steps[0]).toMatchObject({ root: true, script: `cd / && sudo -n -u 'www-data' -H sh -c 'cd "$HOME" && php artisan schedule:run'` })
    expect(cronRunNowAction.plan({ user: 'ghost', command: 'x' }, facts).blocked).not.toBeNull()
  })
})
