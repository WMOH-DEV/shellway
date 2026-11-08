import { describe, expect, it } from 'vitest'
import type { ServerFacts } from '../../../types/server/core'
import { siteJobs } from './jobs'

const facts: ServerFacts = {
  'jobs.supervisor': {
    status: 'ok',
    at: 1,
    data: [
      { name: 'app-worker', command: 'php /var/www/app/current/artisan queue:work', state: 'RUNNING' },
      { name: 'other', command: 'php /var/www/application/artisan queue:work', state: 'RUNNING' }
    ]
  },
  'jobs.cron': { status: 'ok', at: 1, data: { entries: [{ schedule: '* * * * *', command: 'cd /var/www/app && php artisan schedule:run' }] } },
  'jobs.pm2': { status: 'unavailable', reason: 'pm2 not installed', at: 1 },
  'software.php': { status: 'ok', at: 1, data: [{ command: 'php /var/www/app/x' }] }
}

describe('siteJobs', () => {
  it('keeps job entries that run inside the site folder', () => {
    expect(siteJobs(facts, '/var/www/app/')).toEqual([
      { name: 'app-worker', command: 'php /var/www/app/current/artisan queue:work', state: 'RUNNING' },
      { name: '* * * * *', command: 'cd /var/www/app && php artisan schedule:run', state: '' }
    ])
  })

  it('returns nothing without job facts or a site path', () => {
    expect(siteJobs({}, '/var/www/app')).toEqual([])
    expect(siteJobs(facts, '/')).toEqual([])
  })
})
