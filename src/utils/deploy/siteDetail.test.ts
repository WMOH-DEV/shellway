import { describe, it, expect } from 'vitest'
import {
  canRetry,
  deployLabel,
  isLiveRecord,
  layoutLabel,
  liveCaption,
  matchesHistoryFilter,
  matchesHistorySearch,
  newestView,
  recordTitle,
  repoLabel,
  rollbackTarget,
  runStatus,
  sourceView
} from './siteDetail'
import { makeRecord, makeSummary } from './testSummary'

describe('history filters', () => {
  const summary = makeSummary()

  it('puts failed, switched back, cancelled and interrupted runs under Failed', () => {
    const busy = makeSummary({ state: { busy: true } })
    expect(matchesHistoryFilter(makeRecord({ status: 'failed' }), 'failed', summary)).toBe(true)
    expect(matchesHistoryFilter(makeRecord({ status: 'reverted' }), 'failed', summary)).toBe(true)
    expect(matchesHistoryFilter(makeRecord({ status: 'cancelled' }), 'failed', summary)).toBe(true)
    expect(matchesHistoryFilter(makeRecord({ status: 'running' }), 'failed', summary)).toBe(true)
    expect(matchesHistoryFilter(makeRecord({ status: 'running' }), 'failed', busy)).toBe(false)
    expect(matchesHistoryFilter(makeRecord({ status: 'success' }), 'failed', summary)).toBe(false)
  })

  it('puts runs with failed optional commands under Warnings', () => {
    expect(matchesHistoryFilter(makeRecord({ status: 'warning', warnings: 1 }), 'warnings', summary)).toBe(true)
    expect(matchesHistoryFilter(makeRecord({ status: 'success' }), 'warnings', summary)).toBe(false)
    expect(matchesHistoryFilter(makeRecord({ status: 'success' }), 'all', summary)).toBe(true)
  })

  it('searches the commit message, hash, trigger and note', () => {
    const record = makeRecord({ subject: 'Add invoice export', commit: 'f00dbeef1234567', note: 'build failed' })
    expect(matchesHistorySearch(record, 'INVOICE')).toBe(true)
    expect(matchesHistorySearch(record, 'f00db')).toBe(true)
    expect(matchesHistorySearch(record, 'build failed')).toBe(true)
    expect(matchesHistorySearch(record, 'manual')).toBe(true)
    expect(matchesHistorySearch(record, 'nothing')).toBe(false)
    expect(matchesHistorySearch(record, '  ')).toBe(true)
  })
})

describe('recordTitle', () => {
  it('uses the commit message, with fallbacks for env changes and old records', () => {
    expect(recordTitle(makeRecord({ subject: 'Fix tax rounding' }))).toBe('Fix tax rounding')
    expect(recordTitle(makeRecord({ trigger: 'env', subject: 'Fix tax rounding' }))).toBe('Env file changed')
    expect(recordTitle(makeRecord({ trigger: 'rollback' }))).toBe('Rollback')
    expect(recordTitle(makeRecord({ commit: 'abcdef123456' }))).toBe('Commit abcdef1')
    expect(recordTitle(makeRecord({ commit: '' }))).toBe('Deploy')
  })
})

describe('rollback and retry', () => {
  const history = [
    makeRecord({ id: 'd3', status: 'failed', commit: 'ccc' }),
    makeRecord({ id: 'd2', status: 'success', commit: 'aaa' }),
    makeRecord({ id: 'e1', trigger: 'env', commit: 'bbb' }),
    makeRecord({ id: 'd1', status: 'warning', commit: 'bbb' })
  ]

  it('rolls back to the newest good release that is not live', () => {
    const summary = makeSummary({ state: { current: 'aaa', currentRelease: 'd2' }, history })
    expect(rollbackTarget(summary)?.id).toBe('d1')
    expect(rollbackTarget(makeSummary({ history: [history[1]], state: { currentRelease: 'd2' } }))).toBeUndefined()
  })

  it('compares commits for in-place sites', () => {
    const summary = makeSummary({ config: { layout: 'inplace' }, state: { current: 'bbb' }, history })
    expect(rollbackTarget(summary)?.id).toBe('d2')
  })

  it('offers retry only on the newest deploy when it did not succeed', () => {
    const summary = makeSummary({ history })
    expect(canRetry(history[0], summary)).toBe(true)
    expect(canRetry(history[1], summary)).toBe(false)
    const cancelled = makeSummary({ history: [makeRecord({ id: 'e2', trigger: 'env', status: 'failed' }), makeRecord({ id: 'd4', status: 'cancelled' })] })
    expect(canRetry(cancelled.history[1], cancelled)).toBe(true)
    expect(canRetry(cancelled.history[0], cancelled)).toBe(false)
  })
})

describe('summary strip', () => {
  it('labels the deploy button with how many commits it ships', () => {
    expect(deployLabel(makeSummary({ state: { behind: 2 } }))).toBe('Deploy 2 commits')
    expect(deployLabel(makeSummary({ state: { behind: 0 } }))).toBe('Deploy')
    expect(deployLabel(makeSummary({ config: { sourceMode: 'pc' } }), { head: 'x', behind: 1 })).toBe('Deploy 1 commit')
  })

  it('describes the live release', () => {
    const summary = makeSummary({
      state: { current: 'aaa', currentRelease: 'd2', now: 7400 },
      history: [makeRecord({ id: 'd2', commit: 'aaa', trigger: 'pc', finished: 200 })]
    })
    expect(liveCaption(summary)).toBe('from PC · 2 h ago · release d2')
    expect(liveCaption(makeSummary({ config: { layout: 'inplace' } }))).toBe('')
  })

  it('describes the newest commit on the branch', () => {
    const ahead = makeSummary({ state: { current: 'aaa', remoteHead: 'bbb', remoteSubject: 'Bump framework', behind: 2 } })
    expect(newestView(ahead)).toEqual({ head: 'bbb', subject: 'Bump framework', caption: '2 commits ahead of live' })
    const same = makeSummary({ state: { current: 'aaa', remoteHead: 'aaa', currentSubject: 'Live one' } })
    expect(newestView(same)).toEqual({ head: 'aaa', subject: 'Live one', caption: 'Same as live' })
    expect(newestView(makeSummary({ state: { remoteHead: '' } }))).toBeNull()
    expect(newestView(makeSummary({ config: { sourceMode: 'pc' }, state: { current: '' } }), { head: 'ccc', behind: null })).toEqual({ head: 'ccc', subject: '', caption: 'Not deployed yet' })
  })

  it('describes where the code comes from and flags a stale check', () => {
    expect(sourceView(makeSummary({ config: { pollMinutes: 2 }, state: { heartbeat: 1000, now: 1030 } }))).toEqual({
      label: 'Auto on server', caption: 'every 2 min · checked just now', tone: 'success'
    })
    expect(sourceView(makeSummary({ config: { pollMinutes: 1 }, state: { heartbeat: 0, now: 4000 } })).tone).toBe('warning')
    expect(sourceView(makeSummary({ config: { sourceMode: 'pc', pcAuto: true } })).caption).toBe('while Shellway is open')
  })

  it('shortens GitHub repos and labels the layout', () => {
    expect(repoLabel('git@github.com:acme/example-app.git')).toBe('acme/example-app')
    expect(repoLabel('https://git.example.com/app.git')).toBe('https://git.example.com/app.git')
    expect(layoutLabel(makeSummary({ config: { keepReleases: 5 } }).config)).toBe('Releases, 5 kept')
    expect(layoutLabel(makeSummary({ config: { layout: 'inplace' } }).config)).toBe('In place')
  })
})

describe('runStatus', () => {
  it('labels each run, including one the runner never finished', () => {
    const summary = makeSummary()
    expect(runStatus(makeRecord({ status: 'reverted' }), summary)).toEqual({ label: 'Switched back', tone: 'error' })
    expect(runStatus(makeRecord({ status: 'running' }), summary)).toEqual({ label: 'Interrupted', tone: 'error' })
    expect(runStatus(makeRecord({ status: 'running' }), makeSummary({ state: { busy: true } }))).toEqual({ label: 'Running', tone: 'info' })
  })
})

describe('isLiveRecord', () => {
  it('marks the current release, or the newest good deploy of the live commit for in-place sites', () => {
    const history = [makeRecord({ id: 'd3', commit: 'aaa' }), makeRecord({ id: 'd2', commit: 'aaa' }), makeRecord({ id: 'd1', commit: 'bbb' })]
    const releases = makeSummary({ state: { currentRelease: 'd2', current: 'aaa' }, history })
    expect(history.map((r) => isLiveRecord(releases, r))).toEqual([false, true, false])
    const inPlace = makeSummary({ config: { layout: 'inplace' }, state: { current: 'aaa' }, history })
    expect(history.map((r) => isLiveRecord(inPlace, r))).toEqual([true, false, false])
  })
})
