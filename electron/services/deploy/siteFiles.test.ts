import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { SiteConfig } from '../../../src/types/deploy'
import {
  isValidNotifyUrl,
  isValidQuietHours,
  parseSiteFiles,
  parseSteps,
  quoteShellValue,
  serializeSiteConf,
  serializeSteps,
  unquoteShellValue,
  validateSiteConfig
} from './siteFiles'
import { parseDump } from './parse'
import { makeSite } from './testFixtures'

const SCRIPT = resolve(__dirname, '../../../resources/deploy/shellway-deploy.sh')

describe('shell value quoting', () => {
  it('round-trips values with quotes and spaces', () => {
    for (const value of ["it's", "a 'b' c", '', '$HOME `x`', '\\n']) {
      expect(unquoteShellValue(quoteShellValue(value))).toBe(value)
    }
  })
})

describe('steps files', () => {
  it('round-trips required and optional steps', () => {
    const steps = makeSite().activateSteps
    expect(parseSteps(serializeSteps(steps))).toEqual(steps)
  })

  it('ignores blank and malformed lines', () => {
    expect(parseSteps('\nno-tab\nR\t\nO\tok\n')).toEqual([{ optional: true, command: 'ok', timeoutSeconds: null }])
  })
})

describe('site config files', () => {
  it('round-trips a full config', () => {
    const site = makeSite({ sourceMode: 'pc', layout: 'inplace', approveMigrations: true, pcAuto: true, autoRevert: false })
    const parsed = parseSiteFiles(site.name, serializeSiteConf(site), serializeSteps(site.buildSteps), serializeSteps(site.activateSteps))
    expect(parsed).toEqual(site)
  })

  it('writes SOURCE_MODE in the exact form the runner greps for', () => {
    expect(serializeSiteConf(makeSite())).toContain("SOURCE_MODE='auto'\n")
  })

  it.skipIf(process.platform === 'win32')('is read back identically by the runner dump command', () => {
    const root = mkdtempSync(join(tmpdir(), 'sw-conf-'))
    try {
      const site = makeSite({ path: "/srv/o'brien site" })
      const dir = join(root, 'sites', site.name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'site.conf'), serializeSiteConf(site))
      writeFileSync(join(dir, 'steps.build'), serializeSteps(site.buildSteps))
      writeFileSync(join(dir, 'steps.activate'), serializeSteps(site.activateSteps))
      const out = execFileSync('sh', [SCRIPT, 'dump'], { env: { ...process.env, SHELLWAY_DEPLOY_ROOT: root } }).toString()
      const [summary] = parseDump(out)
      expect(summary.config).toEqual(site)
      expect(summary.state.busy).toBe(false)
      expect(summary.history).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('validateSiteConfig', () => {
  it('accepts a sensible config', () => {
    expect(validateSiteConfig(makeSite())).toBeNull()
  })

  it.each<[string, Partial<SiteConfig>]>([
    ['uppercase name', { name: 'Site' }],
    ['traversal name', { name: '../x' }],
    ['relative path', { path: 'var/www' }],
    ['root path', { path: '/' }],
    ['empty repo', { repoUrl: '' }],
    ['bad branch', { branch: 'a..b' }],
    ['shared traversal', { sharedPaths: ['../etc'] }],
    ['shared with space', { sharedPaths: ['my file'] }],
    ['shared wildcard', { sharedPaths: ['storage/*'] }],
    ['shared nested', { sharedPaths: ['storage', 'storage/logs/'] }],
    ['shared duplicate', { sharedPaths: ['storage', 'storage/'] }],
    ['repo url like an option', { repoUrl: '--upload-pack=x' }],
    ['branch like an option', { branch: '-x' }],
    ['absolute env file', { envFile: '/etc/passwd' }],
    ['non-http health url', { healthUrl: 'ftp://x' }],
    ['status out of range', { healthStatus: 99 }],
    ['zero releases', { keepReleases: 0 }],
    ['poll too long', { pollMinutes: 61 }],
    ['multi-line step', { buildSteps: [{ command: 'a\nb', optional: false, timeoutSeconds: null }] }],
    ['tab in step', { activateSteps: [{ command: 'a\tb', optional: false, timeoutSeconds: null }] }],
    ['blank step', { activateSteps: [{ command: '  ', optional: true, timeoutSeconds: null }] }]
  ])('rejects %s', (_label, overrides) => {
    expect(validateSiteConfig(makeSite(overrides))).not.toBeNull()
  })
})

describe('step time limits', () => {
  it('writes the limit after the kind and keeps the command last', () => {
    const steps = [
      { command: 'npm run build', optional: false, timeoutSeconds: 600 },
      { command: 'php artisan route:cache', optional: true, timeoutSeconds: 90 },
      { command: 'echo done', optional: false, timeoutSeconds: null }
    ]
    expect(serializeSteps(steps)).toBe('R:600\tnpm run build\nO:90\tphp artisan route:cache\nR\techo done\n')
  })

  it('round-trips limits', () => {
    const steps = [
      { command: 'npm run build', optional: false, timeoutSeconds: 600 },
      { command: 'php artisan route:cache', optional: true, timeoutSeconds: 5 }
    ]
    expect(parseSteps(serializeSteps(steps))).toEqual(steps)
  })

  it('reads old files without a limit as unlimited', () => {
    expect(parseSteps('R\tone\nO\ttwo\n')).toEqual([
      { command: 'one', optional: false, timeoutSeconds: null },
      { command: 'two', optional: true, timeoutSeconds: null }
    ])
  })

  it.each(['R:', 'R:0', 'R:abc', 'R:-5'])('treats %s as no limit', (kind) => {
    expect(parseSteps(`${kind}\tcmd\n`)).toEqual([{ command: 'cmd', optional: false, timeoutSeconds: null }])
  })

  it('keeps optional steps optional when they have a limit', () => {
    expect(parseSteps('O:30\tcmd\n')[0]).toMatchObject({ optional: true, timeoutSeconds: 30 })
  })

  it.each([0, -1, 1.5, 86_401])('rejects a limit of %s', (timeoutSeconds) => {
    expect(validateSiteConfig(makeSite({ buildSteps: [{ command: 'x', optional: false, timeoutSeconds }] }))).not.toBeNull()
  })

  it('accepts limits from one second to a day', () => {
    for (const timeoutSeconds of [1, 86_400]) {
      expect(validateSiteConfig(makeSite({ buildSteps: [{ command: 'x', optional: false, timeoutSeconds }] }))).toBeNull()
    }
  })
})

describe('quiet hours and notifications', () => {
  it('round-trips both through site.conf', () => {
    const site = makeSite({ quietHours: '22:00-06:00', notifyUrl: 'https://hooks.slack.com/services/T0/B0/x' })
    const parsed = parseSiteFiles(site.name, serializeSiteConf(site), '', '')
    expect(parsed.quietHours).toBe('22:00-06:00')
    expect(parsed.notifyUrl).toBe('https://hooks.slack.com/services/T0/B0/x')
  })

  it('defaults to off for configs written before they existed', () => {
    const parsed = parseSiteFiles('app', "SITE_PATH='/srv/app'\n", '', '')
    expect(parsed.quietHours).toBe('')
    expect(parsed.notifyUrl).toBe('')
  })

  it.each(['', '22:00-06:00', '00:00-23:59', '09:30-17:45'])('accepts quiet hours %j', (value) => {
    expect(isValidQuietHours(value)).toBe(true)
  })

  it.each(['22:00', '24:00-06:00', '22:60-06:00', '9:00-17:00', '10:00-10:00', '22:00-06:00 ', 'night'])('rejects quiet hours %j', (value) => {
    expect(isValidQuietHours(value)).toBe(false)
  })

  it.each(['', 'https://example.com/hook', 'http://example.com:8080/a?b=c'])('accepts notification url %j', (value) => {
    expect(isValidNotifyUrl(value)).toBe(true)
  })

  it.each(['example.com/hook', 'ftp://example.com', 'https://exa mple.com', "https://example.com/'x", 'https://example.com/\\x', '-d x'])('rejects notification url %j', (value) => {
    expect(isValidNotifyUrl(value)).toBe(false)
  })

  it('reports invalid values through validateSiteConfig', () => {
    expect(validateSiteConfig(makeSite({ quietHours: 'bad' }))).toContain('Quiet hours')
    expect(validateSiteConfig(makeSite({ notifyUrl: 'bad' }))).toContain('Notification URL')
  })
})
