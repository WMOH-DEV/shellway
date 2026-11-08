import { describe, it, expect } from 'vitest'
import type { SiteConfig } from '@/types/deploy'
import { applyPreset, newSite } from './presets'
import { firstDeployPlan, needsSave, repoLabel, stepDetail, stepError, type PlanLine } from './setupFlow'

const site = (overrides: Partial<SiteConfig> = {}): SiteConfig => ({
  ...applyPreset(newSite('/var/www/example-app'), 'laravel', { buildScript: false }),
  repoUrl: 'git@github.com:acme/example-app.git',
  ...overrides
})

const context = { existingNames: ['other-app'], nameLocked: false }

const flatten = (line: PlanLine): string => line.map((part) => (typeof part === 'string' ? part : `[${part.code}]`)).join('')

describe('stepError where', () => {
  it('accepts an absolute folder with a valid name', () => {
    expect(stepError('where', site(), context)).toBeNull()
  })

  it.each(['', 'www/app', '/', '//'])('rejects the folder %j', (path) => {
    expect(stepError('where', site({ path }), context)).toMatch(/absolute folder/)
  })

  it('rejects names the server would refuse', () => {
    expect(stepError('where', site({ name: 'My App' }), context)).toMatch(/lowercase/)
    expect(stepError('where', site({ name: '' }), context)).toMatch(/lowercase/)
  })

  it('rejects a name that is already taken, unless the name is locked to the saved site', () => {
    expect(stepError('where', site({ name: 'other-app' }), context)).toMatch(/already exists/)
    expect(stepError('where', site({ name: 'other-app' }), { ...context, nameLocked: true })).toBeNull()
  })
})

describe('stepError code', () => {
  it('needs a repository and a valid branch', () => {
    expect(stepError('code', site({ repoUrl: '' }), context)).toMatch(/repository/)
    expect(stepError('code', site({ repoUrl: 'git@host:a b.git' }), context)).toMatch(/repository/)
    expect(stepError('code', site({ branch: '-x' }), context)).toMatch(/Branch/)
    expect(stepError('code', site({ branch: 'a..b' }), context)).toMatch(/Branch/)
    expect(stepError('code', site(), context)).toBeNull()
  })

  it('checks the interval only for auto sites', () => {
    expect(stepError('code', site({ pollMinutes: 0 }), context)).toMatch(/interval/)
    expect(stepError('code', site({ sourceMode: 'pc', pollMinutes: 0 }), context)).toBeNull()
  })
})

describe('stepError layout and commands', () => {
  it('limits the releases to keep, only for the releases layout', () => {
    expect(stepError('layout', site({ keepReleases: 51 }), context)).toMatch(/Releases to keep/)
    expect(stepError('layout', site({ layout: 'inplace', keepReleases: 51 }), context)).toBeNull()
  })

  it('rejects empty commands, a bad health URL and a bad status', () => {
    const empty = site({ buildSteps: [{ command: '  ', optional: false, timeoutSeconds: null }] })
    expect(stepError('commands', empty, context)).toMatch(/empty commands/)
    expect(stepError('commands', site({ healthUrl: 'example.com/up' }), context)).toMatch(/http/)
    expect(stepError('commands', site({ healthStatus: 99 }), context)).toMatch(/status/)
    expect(stepError('commands', site({ healthUrl: 'https://example.com/up' }), context)).toBeNull()
  })

  it('has nothing to validate on the ready check', () => {
    expect(stepError('ready', site({ repoUrl: '' }), context)).toBeNull()
  })
})

describe('needsSave', () => {
  it('needs a save before the first one and after any change', () => {
    const current = site()
    expect(needsSave(null, current)).toBe(true)
    expect(needsSave(structuredClone(current), current)).toBe(false)
    expect(needsSave(current, { ...current, branch: 'develop' })).toBe(true)
    expect(needsSave(current, { ...current, buildSteps: [...current.buildSteps, { command: 'make', optional: true, timeoutSeconds: null }] })).toBe(true)
  })
})

describe('stepDetail', () => {
  it('summarises each step from the draft', () => {
    const current = site()
    expect(stepDetail('where', current, 'Laravel', null)).toBe('/var/www/example-app · Laravel')
    expect(stepDetail('code', current, 'Laravel', null)).toBe('acme/example-app · main · Auto')
    expect(stepDetail('layout', current, 'Laravel', null)).toBe('Releases · keep 5')
    expect(stepDetail('commands', current, 'Laravel', null)).toBe('7 commands')
  })

  it('handles the in place layout, the PC source and no commands', () => {
    const current = site({ layout: 'inplace', sourceMode: 'pc', buildSteps: [], activateSteps: [] })
    expect(stepDetail('layout', current, 'Custom', null)).toBe('In place')
    expect(stepDetail('code', current, 'Custom', null)).toContain('From my PC')
    expect(stepDetail('commands', current, 'Custom', null)).toBe('No commands')
  })

  it('reports the ready check state', () => {
    const current = site()
    expect([null, 0, 1, 2].map((left) => stepDetail('ready', current, 'Laravel', left)))
      .toEqual(['Not checked yet', 'Ready to deploy', '1 item to fix', '2 items to fix'])
  })
})

describe('repoLabel', () => {
  it('shortens GitHub URLs and keeps other URLs as they are', () => {
    expect(repoLabel(site())).toBe('acme/example-app')
    expect(repoLabel(site({ repoUrl: 'git@git.example.com:acme/example-app.git' }))).toBe('git@git.example.com:acme/example-app.git')
  })
})

describe('firstDeployPlan', () => {
  it('describes a releases deploy that checks the branch by itself', () => {
    const plan = firstDeployPlan(site({ healthUrl: 'https://example.com/up', pollMinutes: 2 }))
    expect(plan.lines.map(flatten)).toEqual([
      'Clone [acme/example-app] at [main]',
      'Build in [releases/<new>] · 2 commands',
      'Point [current] at it',
      'Run 5 after-live commands',
      'Check [https://example.com/up] returns 200'
    ])
    expect(plan.footer && flatten(plan.footer)).toBe('Then checks [main] every 2 mins and deploys new commits by itself.')
  })

  it('describes an in place deploy from the PC without a switch step', () => {
    const plan = firstDeployPlan(site({ layout: 'inplace', sourceMode: 'pc', pcAuto: true, activateSteps: [] }))
    expect(plan.lines.map(flatten)).toEqual([
      'Send [main] of [acme/example-app] from this PC',
      'Run 2 build commands in [/var/www/example-app]'
    ])
    expect(plan.footer && flatten(plan.footer)).toBe('Then deploys new commits while Shellway is open and connected.')
  })

  it('names a missing repository in plain words', () => {
    expect(firstDeployPlan(site({ repoUrl: '' })).lines[0]).toEqual(['Clone ', 'the repository', ' at ', { code: 'main' }])
  })

  it('has no footer for a manual PC site and skips empty stages', () => {
    const plan = firstDeployPlan(site({ sourceMode: 'pc', buildSteps: [], activateSteps: [] }))
    expect(plan.lines.map(flatten)).toEqual(['Send [main] of [acme/example-app] from this PC', 'Build in [releases/<new>]', 'Point [current] at it'])
    expect(plan.footer).toBeNull()
  })
})
