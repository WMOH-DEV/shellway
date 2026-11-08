import { describe, expect, it } from 'vitest'
import type { CronEntry } from './types'
import { agoText, laravelSchedulerCommand, lastResult, newTaskId, plainCommand, siteFor, siteWorkDir, taskSlug } from './view'

const sites = [
  { name: 'shop.example.com', path: '/var/www/shop', workDir: '/var/www/shop/current' },
  { name: 'shop-admin', path: '/var/www/shop/admin', workDir: '/var/www/shop/admin' },
  { name: 'api.example.com', path: '/var/www/api', workDir: '/var/www/api/current' }
]

describe('siteFor', () => {
  it('picks the deepest site folder that holds the directory', () => {
    expect(siteFor('/var/www/shop/current', sites)?.name).toBe('shop.example.com')
    expect(siteFor('/var/www/shop/admin/current', sites)?.name).toBe('shop-admin')
    expect(siteFor('/var/www/api', sites)?.name).toBe('api.example.com')
    expect(siteFor('/var/www/shopfront', sites)).toBeNull()
  })
})

describe('siteWorkDir', () => {
  it('uses the current release for release layouts', () => {
    expect(siteWorkDir('/var/www/shop', 'releases')).toBe('/var/www/shop/current')
    expect(siteWorkDir('/var/www/shop', 'inplace')).toBe('/var/www/shop')
  })
})

describe('task ids', () => {
  it.each([
    ['cd /var/www/api/current && php artisan reports:daily', 'reports-daily'],
    ['/usr/local/bin/backup.sh', 'task'],
    ['cd /srv/app && php artisan schedule:run >> /dev/null 2>&1', 'schedule-run'],
    ['certbot renew -q', 'certbot-renew']
  ])('%s → %s', (command, slug) => {
    expect(taskSlug(command)).toBe(slug)
  })

  it('adds a short random suffix', () => {
    expect(newTaskId('certbot renew', () => 0.5)).toBe('certbot-renew-8000')
  })
})

describe('laravelSchedulerCommand', () => {
  it('matches the Laravel docs line', () => {
    expect(laravelSchedulerCommand('/var/www/shop/current')).toBe('cd /var/www/shop/current && php artisan schedule:run >> /dev/null 2>&1')
  })
})

describe('lastResult', () => {
  const entry: CronEntry = { ref: 'shellway:x', user: 'deploy', source: 'crontab', line: 0, expression: '* * * * *', command: 'x', shellway: { id: 'x', logOutput: false }, lastRun: null }
  const now = 1_793_000_040_000

  it('describes ok, failed and unknown results', () => {
    expect(lastResult({ ...entry, lastRun: { exitCode: 0, at: 1_793_000_000_000 } }, now)).toEqual({ text: 'ok · 40 s ago', tone: 'success' })
    expect(lastResult({ ...entry, lastRun: { exitCode: 3, at: 1_792_978_400_000 } }, now)).toEqual({ text: 'failed (exit 3) · 6 h ago', tone: 'error' })
    expect(lastResult(entry, now).text).toBe('Not run yet')
    expect(lastResult({ ...entry, shellway: null }, now).text).toBe('Not logged')
  })

  it('undoes cron percent escapes for plain lines only', () => {
    expect(plainCommand({ ...entry, shellway: null, command: 'date +\\%F' })).toBe('date +%F')
    expect(plainCommand({ ...entry, command: 'date +%F' })).toBe('date +%F')
  })

  it('formats elapsed time', () => {
    expect(agoText(0, 3 * 86_400_000)).toBe('3 d ago')
    expect(agoText(0, 5 * 60_000)).toBe('5 min ago')
  })
})
