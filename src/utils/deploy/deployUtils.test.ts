import { describe, it, expect } from 'vitest'
import type { SiteSummary } from '@/types/deploy'
import { applyPreset, newSite, siteNameFromPath, suggestPreset } from './presets'
import { commitsBehind, siteBadge, timeAgo, duration } from './siteStatus'
import { sudoersLine } from './sudoers'
import { makeRecord, makeSummary } from './testSummary'

const summary = makeSummary

const record = (status: SiteSummary['history'][number]['status']) => makeRecord({ status })

describe('presets', () => {
  it.each([
    [['artisan', 'composer.json', 'package.json'], 'laravel'],
    [['compose.yaml', 'package.json'], 'compose'],
    [['composer.json'], 'php'],
    [['package.json'], 'node'],
    [['index.html'], 'static'],
    [['README.md'], 'custom']
  ])('suggests a preset for %j', (files, expected) => {
    expect(suggestPreset(files)).toBe(expected)
  })

  it('fills Laravel steps with shared env and storage', () => {
    const site = applyPreset(newSite('/var/www/app'), 'laravel', { buildScript: false })
    expect(site.sharedPaths).toEqual(['.env', 'storage'])
    expect(site.buildSteps[0].command).toContain('composer install')
    expect(site.activateSteps.map((s) => s.command)).toContain('php artisan config:cache')
    expect(site.activateSteps.find((s) => s.command === 'php artisan route:cache')?.optional).toBe(true)
  })

  it('adds npm run build only when the project has a build script', () => {
    expect(applyPreset(newSite(), 'node', { buildScript: false }).buildSteps.map((s) => s.command)).toEqual(['npm ci'])
    expect(applyPreset(newSite(), 'node', { buildScript: true }).buildSteps.map((s) => s.command)).toEqual(['npm ci', 'npm run build'])
  })

  it('forces in-place for Docker Compose', () => {
    expect(applyPreset(newSite(), 'compose', { buildScript: false }).layout).toBe('inplace')
  })

  it('derives a valid site name from the folder', () => {
    expect(siteNameFromPath('/var/www/My_App.v2/')).toBe('my-app-v2')
  })
})

describe('siteBadge', () => {
  it('is live when the server runs the newest commit', () => {
    expect(siteBadge(summary())).toBe('live')
  })

  it('is behind when the branch moved past the live commit', () => {
    expect(siteBadge(summary({ state: { remoteHead: 'bbb' } }))).toBe('behind')
  })

  it('uses the PC-side head for from-pc sites', () => {
    const pc = summary({ config: { sourceMode: 'pc' }, state: { remoteHead: '' } })
    expect(siteBadge(pc, { head: 'bbb', behind: 2 })).toBe('behind')
    expect(siteBadge(pc, { head: 'aaa', behind: 0 })).toBe('live')
  })

  it('counts commits behind from the server for auto sites and from the PC for pc sites', () => {
    expect(commitsBehind(summary({ state: { behind: 3 } }))).toBe(3)
    expect(commitsBehind(summary({ state: { behind: 3 } }), { head: 'x', behind: 9 })).toBe(3)
    const pc = summary({ config: { sourceMode: 'pc' }, state: { behind: 3 } })
    expect(commitsBehind(pc, { head: 'x', behind: 9 })).toBe(9)
    expect(commitsBehind(pc)).toBeNull()
  })

  it('flags an auto check that stopped running', () => {
    expect(siteBadge(summary({ state: { heartbeat: 1000, now: 1000 + 181 } }))).toBe('check-stopped')
    expect(siteBadge(summary({ state: { heartbeat: null, now: 99999 } }))).toBe('live')
  })

  it('puts running, waiting and failed ahead of drift', () => {
    expect(siteBadge(summary({ state: { busy: true, remoteHead: 'bbb' } }))).toBe('deploying')
    expect(siteBadge(summary({ state: { pending: 'bbb' } }))).toBe('waiting')
    expect(siteBadge(summary({ history: [record('reverted')] }))).toBe('failed')
  })

  it('keeps showing a failed deploy after a later env change succeeds', () => {
    const env = { ...record('success'), id: 'a1', trigger: 'env' }
    expect(siteBadge(summary({ history: [env, record('failed')] }))).toBe('failed')
    expect(siteBadge(summary({ history: [{ ...env, status: 'failed' }, record('success')] }))).toBe('failed')
    expect(siteBadge(summary({ history: [env, record('success')] }))).toBe('live')
  })

  it('treats a running record with no live runner as failed, not deploying', () => {
    expect(siteBadge(summary({ history: [record('running')] }))).toBe('failed')
    expect(siteBadge(summary({ state: { busy: true }, history: [record('running')] }))).toBe('deploying')
  })

  it('is never when nothing was deployed yet', () => {
    expect(siteBadge(summary({ state: { current: '' } }))).toBe('never')
  })
})

describe('formatting', () => {
  it('describes elapsed time and duration', () => {
    expect(timeAgo(0, 30)).toBe('just now')
    expect(timeAgo(0, 7200)).toBe('2 h ago')
    expect(duration({ ...record('success'), started: 10, finished: 85 })).toBe('1m 15s')
  })
})

describe('sudoersLine', () => {
  it('escapes characters sudoers treats specially', () => {
    expect(sudoersLine('deploy', ['/usr/bin/systemctl restart a', '/bin/echo a,b:c=d']))
      .toBe('deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart a, /bin/echo a\\,b\\:c\\=d')
  })
})
