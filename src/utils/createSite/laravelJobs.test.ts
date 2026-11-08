import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ALL_JOBS, NO_JOBS, availableJobs, createJobsScript, cronText, jobFiles, removeJobsScript, unitText } from './laravelJobs'
import { LEFT_IN_PLACE } from './refusal'
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
    const script = removeJobsScript(baseInput(), jobFiles('shop', ALL_JOBS))
    expect(script.indexOf('systemctl disable --now')).toBeLessThan(script.indexOf("rm -f '/etc/systemd/system/shellway-shop-queue.service'"))
    expect(script).toContain("rm -f '/etc/cron.d/shellway-shop'")
  })

  describe('on a server', () => {
    let root = ''
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'jobs-'))
      mkdirSync(join(root, 'cron.d'))
      mkdirSync(join(root, 'systemd', 'system'), { recursive: true })
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    const run = (script: string) => {
      const fakes = `systemctl() { echo "systemctl $*" >> '${root}/log'; }\n`
      return spawnSync('sh', ['-s'], { input: fakes + script.replaceAll('/etc/', `${root}/`), encoding: 'utf8' })
    }
    const cron = () => join(root, 'cron.d', 'shellway-shop')
    const unit = () => join(root, 'systemd', 'system', 'shellway-shop-queue.service')

    it('removes both files when they are what Shellway wrote', () => {
      writeFileSync(cron(), cronText(baseInput()))
      writeFileSync(unit(), unitText(baseInput()))
      const result = run(removeJobsScript(baseInput(), jobFiles('shop', ALL_JOBS)))
      expect(result.status).toBe(0)
      expect(existsSync(cron())).toBe(false)
      expect(existsSync(unit())).toBe(false)
    })

    it('keeps the file changed by hand and still removes the unchanged one', () => {
      writeFileSync(cron(), cronText(baseInput()).replace('* * * * *', '*/5 * * * *'))
      writeFileSync(unit(), unitText(baseInput()))
      const result = run(removeJobsScript(baseInput(), jobFiles('shop', ALL_JOBS)))
      expect(result.status).toBe(3)
      expect(result.stderr.trim()).toBe(`Changed after Shellway wrote it: ${cron()}. ${LEFT_IN_PLACE}`)
      expect(existsSync(cron())).toBe(true)
      expect(existsSync(unit())).toBe(false)
      expect(readFileSync(join(root, 'log'), 'utf8')).toContain("disable --now shellway-shop-queue.service")
    })

    it('stops nothing when the queue worker unit was changed by hand', () => {
      writeFileSync(cron(), cronText(baseInput()))
      writeFileSync(unit(), unitText(baseInput()).replace('--tries=3', '--tries=5'))
      const result = run(removeJobsScript(baseInput(), jobFiles('shop', ALL_JOBS)))
      expect(result.status).toBe(3)
      expect(result.stderr).toContain(`${unit()}. ${LEFT_IN_PLACE}`)
      expect(existsSync(unit())).toBe(true)
      expect(existsSync(cron())).toBe(false)
      expect(existsSync(join(root, 'log'))).toBe(false)
    })

    it('succeeds when the files are already gone', () => {
      expect(run(removeJobsScript(baseInput(), jobFiles('shop', ALL_JOBS))).status).toBe(0)
    })
  })
})
