import { describe, expect, it } from 'vitest'
import { ALL_JOBS, NO_JOBS, availableJobs, createJobsScript, cronText, jobFiles, removeJobsScript, unitText } from './laravelJobs'
import { baseInput } from './testFixtures'

describe('jobFiles', () => {
  it('names the cron file without dots, since cron skips file names that contain one', () => {
    expect(jobFiles('shop.example', ALL_JOBS)).toEqual({
      cronFile: '/etc/cron.d/shellway-shop-example',
      unitFile: '/etc/systemd/system/shellway-shop-example-queue.service'
    })
  })

  it('leaves out what was not asked for', () => {
    expect(jobFiles('shop', { scheduler: true, queueWorker: false })).toEqual({ cronFile: '/etc/cron.d/shellway-shop', unitFile: null })
  })

  it('refuses a site name that could leave /etc', () => {
    expect(() => jobFiles('../shop', ALL_JOBS)).toThrow()
  })
})

describe('availableJobs', () => {
  it('turns off what the server cannot run', () => {
    expect(availableJobs({ cron: true, systemd: false }, ALL_JOBS)).toEqual({ scheduler: true, queueWorker: false })
    expect(availableJobs({ cron: true, systemd: true }, NO_JOBS)).toEqual(NO_JOBS)
  })
})

describe('cronText', () => {
  it('runs the scheduler as the site user in the site folder with the pinned PHP', () => {
    expect(cronText(baseInput())).toBe('* * * * * deploy cd /var/www/shop && php8.3 artisan schedule:run >> /dev/null 2>&1\n')
  })

  it('uses the single php on RHEL', () => {
    expect(cronText(baseInput({ server: { kind: 'apache', layout: 'rhel' } }))).toContain('&& php artisan schedule:run')
  })
})

describe('unitText', () => {
  it('runs the worker as the site user and restarts it when it exits', () => {
    const unit = unitText(baseInput())
    expect(unit).toContain('User=deploy')
    expect(unit).toContain('WorkingDirectory=/var/www/shop')
    expect(unit).toContain('ExecStart=/usr/bin/env php8.3 artisan queue:work --sleep=3 --tries=3 --max-time=3600')
    expect(unit).toContain('Restart=always')
    expect(unit).toContain('WantedBy=multi-user.target')
  })
})

describe('createJobsScript', () => {
  it('refuses before writing anything when either file exists with other content', () => {
    const script = createJobsScript(baseInput(), ALL_JOBS)
    const firstWrite = script.indexOf('cat >')
    expect(script.indexOf("if [ -e '/etc/cron.d/shellway-shop' ]")).toBeLessThan(firstWrite)
    expect(script.indexOf("if [ -e '/etc/systemd/system/shellway-shop-queue.service' ]")).toBeLessThan(firstWrite)
    expect(script).toContain("! cmp -s '/etc/cron.d/shellway-shop' -")
    expect(script).toContain('exit 3')
  })

  it('writes the cron file and starts the worker', () => {
    const script = createJobsScript(baseInput(), ALL_JOBS)
    expect(script).toContain("chmod 644 '/etc/cron.d/shellway-shop'")
    expect(script).toContain("systemctl enable --now 'shellway-shop-queue.service'")
  })

  it('touches systemd only when the worker is wanted', () => {
    expect(createJobsScript(baseInput(), { scheduler: true, queueWorker: false })).not.toContain('systemctl')
  })
})

describe('removeJobsScript', () => {
  it('stops the worker before removing its unit, and removes the cron file', () => {
    const script = removeJobsScript('shop', jobFiles('shop', ALL_JOBS))
    expect(script.indexOf('systemctl disable --now')).toBeLessThan(script.indexOf("rm -f '/etc/systemd/system/shellway-shop-queue.service'"))
    expect(script).toContain("rm -f '/etc/cron.d/shellway-shop'")
  })
})
