import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { SiteConfig } from '../../../src/types/deploy'
import {
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
    expect(parseSteps('\nno-tab\nR\t\nO\tok\n')).toEqual([{ optional: true, command: 'ok' }])
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
    ['multi-line step', { buildSteps: [{ command: 'a\nb', optional: false }] }],
    ['tab in step', { activateSteps: [{ command: 'a\tb', optional: false }] }],
    ['blank step', { activateSteps: [{ command: '  ', optional: true }] }]
  ])('rejects %s', (_label, overrides) => {
    expect(validateSiteConfig(makeSite(overrides))).not.toBeNull()
  })
})
