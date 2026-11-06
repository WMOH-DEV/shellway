import { describe, it, expect } from 'vitest'
import type { DeployProgress } from '@/types/deploy'
import {
  awayParts,
  awaySummary,
  behindChip,
  cancelBlockedReason,
  canCancel,
  filterCounts,
  formatElapsed,
  liveRecord,
  matchesFilter,
  matchesSearch,
  progressView,
  recentRuns,
  rowAction,
  runsCaption,
  shortPath,
  sourceMeta,
  triggerLabel
} from './siteRow'
import { makeRecord, makeSummary } from './testSummary'

const progress = (overrides: Partial<DeployProgress> = {}): DeployProgress => ({
  stage: 'build', step: 2, steps: 5, command: 'npm run build', ...overrides
})

describe('filters and search', () => {
  const failed = makeSummary({ config: { name: 'shop' }, history: [makeRecord({ status: 'failed' })] })
  const waiting = makeSummary({ config: { name: 'api' }, state: { pending: 'bbb' } })
  const stopped = makeSummary({ config: { name: 'docs', pollMinutes: 1 }, state: { heartbeat: 100, now: 1000 } })
  const behind = makeSummary({ config: { name: 'blog' }, state: { remoteHead: 'bbb', behind: 2 } })
  const pc = makeSummary({ config: { name: 'landing', sourceMode: 'pc' } })

  it('counts failed, waiting and stopped sites as needing attention but not sites that are only behind', () => {
    expect([failed, waiting, stopped, behind, pc].filter((s) => matchesFilter(s, 'attention')).map((s) => s.config.name))
      .toEqual(['shop', 'api', 'docs'])
  })

  it('counts each filter', () => {
    expect(filterCounts([failed, waiting, stopped, behind, pc], {})).toEqual({ all: 5, attention: 3, auto: 4, pc: 1 })
  })

  it('searches name, path, repository and branch, ignoring case', () => {
    const site = makeSummary({ config: { name: 'shop', path: '/var/www/store', repoUrl: 'git@github.com:acme/Storefront.git', branch: 'release' } })
    expect(['SHOP', 'www/store', 'storefront', 'releas', '  '].map((q) => matchesSearch(site, q))).toEqual([true, true, true, true, true])
    expect(matchesSearch(site, 'blog')).toBe(false)
  })
})

describe('shortPath', () => {
  it('shortens the ssh user home to ~', () => {
    expect(shortPath('/home/deploy/www/app', 'deploy')).toBe('~/www/app')
    expect(shortPath('/root/app', 'root')).toBe('~/app')
    expect(shortPath('/home/deploy', 'deploy')).toBe('~')
  })

  it('leaves other paths alone', () => {
    expect(shortPath('/home/deployer/app', 'deploy')).toBe('/home/deployer/app')
    expect(shortPath('/var/www/app', 'deploy')).toBe('/var/www/app')
    expect(shortPath('/home/deploy/app', '')).toBe('/home/deploy/app')
  })
})

describe('recent runs', () => {
  it('lists the last runs oldest first, with reverted and interrupted runs as failed', () => {
    const site = makeSummary({
      history: [
        makeRecord({ id: 'd4', status: 'running' }),
        makeRecord({ id: 'd3', status: 'reverted' }),
        makeRecord({ id: 'd2', status: 'cancelled' }),
        makeRecord({ id: 'd1', status: 'warning' })
      ]
    })
    expect(recentRuns(site)).toEqual(['warning', 'cancelled', 'failed', 'failed'])
    expect(recentRuns(makeSummary({ state: { busy: true }, history: [makeRecord({ status: 'running' })] }))).toEqual(['running'])
  })

  it('keeps only the newest ten', () => {
    const history = Array.from({ length: 12 }, (_, i) => makeRecord({ id: `d${i}`, status: i === 0 ? 'failed' : 'success' }))
    const runs = recentRuns(makeSummary({ history }))
    expect(runs).toHaveLength(10)
    expect(runs[9]).toBe('failed')
  })

  it.each([
    [[], {}, 'No runs yet'],
    [[makeRecord({ status: 'running', finished: null })], { busy: true }, 'running'],
    [[makeRecord({ status: 'waiting', finished: 280 })], { now: 1000 }, 'waiting 12 min'],
    [[makeRecord({ status: 'failed', finished: 820 })], { now: 1000 }, 'failed 3 min ago'],
    [[makeRecord({ status: 'cancelled', finished: 990 })], { now: 1000 }, 'cancelled just now'],
    [[makeRecord({ status: 'success', started: 100, finished: 118 })], {}, '18s']
  ])('captions the latest run %#', (history, state, caption) => {
    expect(runsCaption(makeSummary({ history, state }))).toBe(caption)
  })
})

describe('live commit', () => {
  it('finds the newest successful run of the live commit, env changes included', () => {
    const site = makeSummary({
      state: { current: 'aaa' },
      history: [
        makeRecord({ id: 'd3', status: 'failed', commit: 'bbb' }),
        makeRecord({ id: 'd2', status: 'success', trigger: 'env', commit: 'aaa' }),
        makeRecord({ id: 'd1', status: 'success', commit: 'aaa' })
      ]
    })
    expect(liveRecord(site)?.id).toBe('d2')
  })

  it.each([['manual', 'manual'], ['auto', 'auto'], ['pc', 'from PC'], ['approve', 'approved'], ['rollback', 'rollback'], ['env', 'env'], ['other', 'other']])(
    'labels the %s trigger', (trigger, label) => expect(triggerLabel(trigger)).toBe(label)
  )
})

describe('behindChip', () => {
  it('counts the commits a failed site is behind', () => {
    const site = makeSummary({ state: { remoteHead: 'ccc', behind: 2 }, history: [makeRecord({ status: 'failed' })] })
    expect(behindChip(site)).toEqual({ label: '2 commits behind', tone: 'info' })
  })

  it('says up to date when nothing is behind', () => {
    expect(behindChip(makeSummary({ state: { behind: 0 } }))).toEqual({ label: 'Up to date', tone: 'muted' })
  })

  it('flags the migration a waiting site needs approved', () => {
    expect(behindChip(makeSummary({ state: { pending: 'bbb', behind: 2 } }))).toEqual({ label: '2 new · adds a migration', tone: 'warning' })
    expect(behindChip(makeSummary({ state: { pending: 'bbb', behind: null } }))).toEqual({ label: 'new commit · adds a migration', tone: 'warning' })
  })

  it('stays hidden when the badge already says the site is behind, the count is unknown or nothing is live', () => {
    expect(behindChip(makeSummary({ state: { remoteHead: 'bbb', behind: 1 } }))).toBeNull()
    expect(behindChip(makeSummary({ state: { behind: null } }))).toBeNull()
    expect(behindChip(makeSummary({ state: { current: '', behind: 0 } }))).toBeNull()
  })

  it('uses the PC count for sites deployed from the PC', () => {
    const site = makeSummary({ config: { sourceMode: 'pc' }, history: [makeRecord({ status: 'failed' })] })
    expect(behindChip(site, { head: 'ccc', behind: 1 })).toEqual({ label: '1 commit behind', tone: 'info' })
  })
})

describe('sourceMeta', () => {
  it('describes branch, layout and schedule', () => {
    expect(sourceMeta(makeSummary({ config: { branch: 'main', layout: 'releases', sourceMode: 'auto', pollMinutes: 2 } }).config))
      .toBe('main · Releases · every 2 min')
    expect(sourceMeta(makeSummary({ config: { branch: 'dev', layout: 'inplace', sourceMode: 'pc', pcAuto: false } }).config))
      .toBe('dev · In place · on click')
    expect(sourceMeta(makeSummary({ config: { branch: 'main', layout: 'releases', sourceMode: 'pc', pcAuto: true } }).config))
      .toBe('main · Releases · while Shellway is open')
  })
})

describe('progress', () => {
  it('shows the stage, step and running command', () => {
    expect(progressView(progress())).toEqual({ label: 'Building', step: 'step 2 of 5', command: 'npm run build', fraction: 0.2 })
  })

  it('counts a finished step between commands', () => {
    expect(progressView(progress({ stage: 'activate', step: 3, command: '' }))).toEqual({ label: 'Going live', step: '', command: '', fraction: 0.6 })
  })

  it('handles fetching, health checks, missing steps and no progress yet', () => {
    expect(progressView(progress({ stage: 'fetch', step: 0, command: '' })).fraction).toBe(0)
    expect(progressView(progress({ stage: 'health', step: 5, command: '' }))).toMatchObject({ label: 'Checking health', fraction: 1 })
    expect(progressView(progress({ steps: 0, step: 0, command: '' })).fraction).toBe(0)
    expect(progressView(null)).toEqual({ label: 'Starting', step: '', command: '', fraction: 0 })
  })

  it('allows cancelling only before going live and only once', () => {
    const busy = (p: DeployProgress | null, cancelling = false) => makeSummary({ state: { busy: true, progress: p, cancelling } })
    expect(canCancel(busy(progress()))).toBe(true)
    expect(canCancel(busy(progress({ stage: 'fetch' })))).toBe(true)
    expect(canCancel(busy(null))).toBe(true)
    expect(canCancel(busy(progress({ stage: 'activate' })))).toBe(false)
    expect(canCancel(busy(progress({ stage: 'health' })))).toBe(false)
    expect(canCancel(busy(progress(), true))).toBe(false)
    expect(canCancel(makeSummary())).toBe(false)
  })

  it('stops offering cancel once an in-place deploy has changed the site folder', () => {
    const inPlace = (p: DeployProgress) => makeSummary({ config: { layout: 'inplace' }, state: { busy: true, progress: p } })
    expect(canCancel(inPlace(progress({ stage: 'fetch' })))).toBe(true)
    expect(canCancel(inPlace(progress({ stage: 'build' })))).toBe(false)
    expect(cancelBlockedReason(inPlace(progress({ stage: 'build' })))).toContain('half-built')
  })

  it('explains why cancel is not available', () => {
    expect(cancelBlockedReason(makeSummary({ state: { busy: true, cancelling: true } }))).toBe('Cancelling…')
    expect(cancelBlockedReason(makeSummary({ state: { busy: true, progress: progress({ stage: 'activate' }) } }))).toContain('going live')
  })

  it.each([[5, '0:05'], [84, '1:24'], [3725, '1:02:05'], [-3, '0:00']])('formats %i seconds as %s', (seconds, text) => {
    expect(formatElapsed(seconds)).toBe(text)
  })
})

describe('rowAction', () => {
  it.each([
    ['deploying', 'cancel'], ['waiting', 'review'], ['check-stopped', 'resume'],
    ['failed', 'deploy'], ['live', 'deploy'], ['behind', 'deploy'], ['never', 'deploy']
  ] as const)('offers %s sites the %s action', (badge, action) => {
    expect(rowAction(badge)).toBe(action)
  })
})

describe('while you were away', () => {
  const sites = [
    makeSummary({
      config: { name: 'shop' },
      history: [
        makeRecord({ id: 'd4', status: 'failed', trigger: 'auto', finished: 900 }),
        makeRecord({ id: 'd3', status: 'success', trigger: 'manual', finished: 800 }),
        makeRecord({ id: 'd2', status: 'success', trigger: 'auto', finished: 700 }),
        makeRecord({ id: 'd1', status: 'success', trigger: 'auto', finished: 100 })
      ]
    }),
    makeSummary({
      config: { name: 'api' },
      state: { busy: true },
      history: [
        makeRecord({ id: 'e4', status: 'running', trigger: 'auto', started: 950, finished: null }),
        makeRecord({ id: 'e3', status: 'cancelled', trigger: 'pc', finished: 700 }),
        makeRecord({ id: 'e2', status: 'waiting', trigger: 'pc', finished: 650 }),
        makeRecord({ id: 'e1', status: 'warning', trigger: 'pc', finished: 600 })
      ]
    })
  ]

  it('counts finished automatic runs since the last visit', () => {
    expect(awaySummary(sites, 500)).toEqual({ total: 5, succeeded: 2, failed: 1, waiting: 1, cancelled: 1, failedSites: ['shop'] })
  })

  it('counts an interrupted run as failed but not one that is still running', () => {
    const site = makeSummary({ config: { name: 'shop' }, state: { busy: false }, history: [makeRecord({ status: 'running', trigger: 'auto', started: 600, finished: null })] })
    expect(awaySummary([site], 500)).toMatchObject({ total: 1, failed: 1, failedSites: ['shop'] })
    expect(awaySummary([{ ...site, state: { ...site.state, busy: true } }], 500)).toBeNull()
  })

  it('has nothing to say without a last visit or new runs', () => {
    expect(awaySummary(sites, null)).toBeNull()
    expect(awaySummary(sites, 900)).toBeNull()
  })

  it('words the summary', () => {
    expect(awayParts({ total: 5, succeeded: 2, failed: 1, waiting: 1, cancelled: 1, failedSites: ['shop'] }))
      .toEqual({
        runs: '5 auto deploys',
        outcomes: [
          { text: '2 succeeded', tone: 'plain' },
          { text: '1 failed on shop', tone: 'error' },
          { text: '1 waiting for approval', tone: 'warning' },
          { text: '1 cancelled', tone: 'plain' }
        ]
      })
    expect(awayParts({ total: 1, succeeded: 1, failed: 0, waiting: 0, cancelled: 0, failedSites: [] }))
      .toEqual({ runs: '1 auto deploy', outcomes: [{ text: '1 succeeded', tone: 'plain' }] })
  })
})
