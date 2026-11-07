import { describe, expect, it } from 'vitest'
import { DISK_ROUTE, failureLines, findHint, type HintInput } from './hints'
import type { FailedDetails } from './types'

const NO_DETAILS: FailedDetails = { units: {}, programs: {}, nginxTest: null, apacheTest: null, listeners: [] }

function input(kind: HintInput['item']['kind'], name: string, lines: string[], extra: Partial<FailedDetails> = {}, detail = ''): HintInput {
  return { item: { kind, name, user: kind === 'pm2' ? 'deploy' : null, state: 'failed', detail }, lines, failed: { ...NO_DETAILS, ...extra } }
}

const APACHE_ON_80 = { listeners: [{ address: '0.0.0.0:80', port: 80, process: 'apache2' }] }

describe('findHint', () => {
  it.each<[string, HintInput, string, string | null]>([
    ['port conflict names the owner', input('systemd', 'nginx', ['nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)'], APACHE_ON_80), 'port-in-use', 'show'],
    ['port conflict without an owner', input('systemd', 'nginx', ['bind() to [::]:443 failed (98: Address already in use)']), 'port-in-use', null],
    ['nginx config error', input('systemd', 'nginx', ['nginx: [emerg] unknown directive "servr_name" in /etc/nginx/sites-enabled/shop:3'], { nginxTest: 'nginx: configuration file /etc/nginx/nginx.conf test failed' }), 'nginx-config', 'show'],
    ['apache config error', input('systemd', 'apache2', ['AH00526: Syntax error on line 12'], { apacheTest: 'AH00526: Syntax error on line 12 of /etc/apache2/sites-enabled/shop.conf' }), 'apache-config', 'show'],
    ['php-fpm socket', input('systemd', 'php8.3-fpm', ['ERROR: unable to bind listening socket for address \'/run/php/php8.3-fpm.sock\': Address already in use (98)']), 'php-fpm-bind', 'control'],
    ['php-fpm socket only', input('systemd', 'php8.3-fpm', ['ERROR: unable to bind listening socket for address \'/run/php/php8.3-fpm.sock\'']), 'php-fpm-bind', 'control'],
    ['disk full', input('systemd', 'mysql', ['[ERROR] [MY-000035] Disk is full writing \'./binlog.000042\' (OS errno 28 - No space left on device)']), 'disk-full', 'route'],
    ['redis log file', input('systemd', 'redis-server', ["Can't open the log file: Permission denied"]), 'redis-log', 'fix'],
    ['supervisor missing command', input('supervisor', 'broken', [], {}, "can't find command '/srv/app/bin/missing'"), 'supervisor-command', 'route'],
    ['supervisor spawn error', input('supervisor', 'shop-queue:default_00', ['spawnerr: can\'t find command']), 'supervisor-command', 'route'],
    ['supervisor backoff', input('supervisor', 'shop-queue:default_00', ['PHP Fatal error: Class "Redis" not found'], {}, 'Exited too quickly (process log may have details)'), 'supervisor-backoff', 'logs'],
    ['pm2 errored', input('pm2', 'admin', []), 'pm2-errored', 'logs'],
    ['start limit', input('systemd', 'acme-api', ['acme-api.service: Start request repeated too quickly.']), 'start-limit', 'control'],
    ['permission denied on a folder', input('systemd', 'acme-api', ['open /srv/acme/storage/app.sock: Permission denied']), 'permission-denied', null]
  ])('%s', (_name, hintInput, id, fixKind) => {
    const hint = findHint(hintInput)
    expect(hint?.id).toBe(id)
    expect(hint?.fix?.kind ?? null).toBe(fixKind)
  })

  it('returns nothing for an unknown failure', () => {
    expect(findHint(input('systemd', 'acme-api', ['acme-api.service: Main process exited, code=exited, status=1/FAILURE']))).toBeNull()
  })

  it('names the process that holds the port', () => {
    const hint = findHint(input('systemd', 'nginx', ['bind() to 0.0.0.0:80 failed (98: Address already in use)'], APACHE_ON_80))
    expect(hint?.text).toContain('Port 80 is already taken by apache2')
  })

  it('builds the fix actions with the right params', () => {
    expect(findHint(input('systemd', 'redis-server', ["Can't open the log file: Permission denied"]))?.fix).toEqual({ kind: 'fix', label: 'Fix and start', params: { fix: 'redis-log-owner', unit: 'redis-server' } })
    expect(findHint(input('systemd', 'php8.3-fpm', ['unable to bind listening socket for address']))?.fix).toEqual({ kind: 'control', label: 'Restart', params: { kind: 'systemd', name: 'php8.3-fpm', verb: 'restart', user: null } })
    expect(findHint(input('systemd', 'mysql', ['No space left on device']))?.fix).toEqual({ kind: 'route', label: 'Free disk space', route: DISK_ROUTE })
  })

  it('names the denied path', () => {
    expect(findHint(input('systemd', 'acme-api', ['open /srv/acme/storage/app.sock: Permission denied']))?.text).toContain('/srv/acme/storage/app.sock')
  })
})

describe('failureLines', () => {
  const failed: FailedDetails = { ...NO_DETAILS, units: { nginx: ['a'] }, programs: { worker: ['b'] } }
  it.each([
    ['systemd', 'nginx', ['a']],
    ['supervisor', 'worker', ['b']],
    ['pm2', 'worker', []],
    ['systemd', 'mysql', []]
  ] as const)('%s %s', (kind, name, expected) => {
    expect(failureLines({ kind, name }, failed)).toEqual(expected)
  })
})
