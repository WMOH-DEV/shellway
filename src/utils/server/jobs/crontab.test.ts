import { describe, expect, it } from 'vitest'
import { parseSystemCrontab, parseUserCrontab, replaceEntry, shellwayCronLine } from './crontab'
import { parseCrontabs } from './crontabs'

const task = { id: 'reports-daily-a1b2', expression: '30 6 * * *', command: 'cd /var/www/api/current && date +%F', logOutput: true }

describe('shellwayCronLine', () => {
  it('wraps the command, escapes % and tags the line', () => {
    expect(shellwayCronLine(task)).toBe(
      '30 6 * * * (cd /var/www/api/current && date +\\%F) >> /var/log/shellway/cron-reports-daily-a1b2.log 2>&1; echo "shellway-exit $? $(date +\\%s)" >> /var/log/shellway/cron-reports-daily-a1b2.log # shellway:reports-daily-a1b2'
    )
  })

  it('discards output but keeps the exit marker when logging is off', () => {
    const line = shellwayCronLine({ ...task, logOutput: false })
    expect(line).toContain('(cd /var/www/api/current && date +\\%F) > /dev/null 2>&1; echo "shellway-exit $? $(date +\\%s)" > /var/log/shellway/cron-reports-daily-a1b2.log')
  })

  it('reads back what it writes', () => {
    for (const logOutput of [true, false]) {
      const [entry] = parseUserCrontab(`${shellwayCronLine({ ...task, logOutput })}\n`, 'deploy')
      expect(entry).toMatchObject({ ref: `shellway:${task.id}`, expression: '30 6 * * *', command: task.command, shellway: { id: task.id, logOutput } })
    }
  })
})

describe('parseUserCrontab', () => {
  const text = [
    '# m h dom mon dow command',
    'MAILTO=""',
    'PATH=/usr/local/bin:/usr/bin:/bin',
    '',
    '* * * * * cd /var/www/shop/current && php artisan schedule:run >> /dev/null 2>&1',
    '@reboot /home/deploy/start.sh',
    '0  3 * * *   /usr/local/bin/backup.sh # nightly'
  ].join('\n')

  it('lists entries with their line numbers and skips comments and variables', () => {
    expect(parseUserCrontab(text, 'deploy')).toEqual([
      { ref: 'line:4', user: 'deploy', source: 'crontab', line: 4, expression: '* * * * *', command: 'cd /var/www/shop/current && php artisan schedule:run >> /dev/null 2>&1', shellway: null, lastRun: null },
      { ref: 'line:5', user: 'deploy', source: 'crontab', line: 5, expression: '@reboot', command: '/home/deploy/start.sh', shellway: null, lastRun: null },
      { ref: 'line:6', user: 'deploy', source: 'crontab', line: 6, expression: '0 3 * * *', command: '/usr/local/bin/backup.sh # nightly', shellway: null, lastRun: null }
    ])
  })
})

describe('parseSystemCrontab', () => {
  it('reads the user column', () => {
    const text = 'SHELL=/bin/sh\n17 * * * * root cd / && run-parts --report /etc/cron.hourly\n0 */12 * * * root test -x /usr/bin/certbot && certbot -q renew\n'
    const entries = parseSystemCrontab(text, '/etc/cron.d/certbot')
    expect(entries.map((entry) => [entry.ref, entry.user, entry.expression, entry.command])).toEqual([
      ['/etc/cron.d/certbot:1', 'root', '17 * * * *', 'cd / && run-parts --report /etc/cron.hourly'],
      ['/etc/cron.d/certbot:2', 'root', '0 */12 * * *', 'test -x /usr/bin/certbot && certbot -q renew']
    ])
  })
})

describe('replaceEntry', () => {
  it('appends, replaces and removes lines', () => {
    expect(replaceEntry('', null, 'a')).toBe('a\n')
    expect(replaceEntry('x\ny\n', null, 'a')).toBe('x\ny\na\n')
    expect(replaceEntry('x\ny\n', 1, 'a')).toBe('x\na\n')
    expect(replaceEntry('x\ny', 0, null)).toBe('y\n')
    expect(replaceEntry('x\n', 0, null)).toBe('')
  })
})

describe('parseCrontabs', () => {
  const line = shellwayCronLine(task)
  const stdout = [
    '@@self deploy',
    '@@crontab deploy 1111111111111111111111111111111111111111111111111111111111111111',
    'MAILTO=""',
    line,
    '',
    '@@end',
    '@@others yes',
    '@@crontab root e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '',
    '@@end',
    `@@last ${task.id} shellway-exit 2 1793000000`,
    '@@system /etc/crontab',
    '25 6 * * * root test -x /usr/sbin/anacron || run-parts --report /etc/cron.daily',
    '',
    '@@end',
    ''
  ].join('\n')

  it('keeps the exact crontab text, hash, last result and system entries', () => {
    const facts = parseCrontabs(stdout)
    expect(facts.self).toBe('deploy')
    expect(facts.readsOthers).toBe(true)
    expect(facts.crontabs.map((crontab) => [crontab.user, crontab.text])).toEqual([
      ['deploy', `MAILTO=""\n${line}\n`],
      ['root', '']
    ])
    expect(facts.crontabs[0].entries[0].lastRun).toEqual({ exitCode: 2, at: 1793000000000 })
    expect(facts.system).toHaveLength(1)
    expect(facts.system[0].user).toBe('root')
  })

  it('keeps a crontab without a final newline as is', () => {
    const facts = parseCrontabs('@@self deploy\n@@crontab deploy abc\n* * * * * true\n@@end\n')
    expect(facts.crontabs[0].text).toBe('* * * * * true')
  })

  it('reports a missing crontab command', () => {
    expect(parseCrontabs('@@self deploy\n@@missing\n')).toEqual({ installed: false, self: 'deploy', readsOthers: false, crontabs: [], system: [] })
  })
})
