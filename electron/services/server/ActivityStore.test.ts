import { existsSync, mkdtempSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import type { ActivityEntry } from '../../../src/types/server/core'
import type { RunRecord } from '../../../src/types/createSite'
import type { DeployRecord } from '../../../src/types/deploy'
import { ActivityStore } from './ActivityStore'
import { entryFromCreateSite, entryFromDeploy, entryFromRun, MAX_ACTIVITY_OUTPUT } from './activityEntries'

const entry = (id: string, at: number, overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id,
  sessionKey: 's1',
  at,
  area: 'software',
  source: 'action',
  type: 'software.install',
  title: `Entry ${id}`,
  who: 'you',
  durationMs: 1000,
  status: 'done',
  steps: [{ label: 'Install', display: 'apt-get install nginx', output: '', exitCode: 0, status: 'done' }],
  failure: null,
  ...overrides
})

const dir = () => mkdtempSync(join(tmpdir(), 'shellway-activity-'))

describe('ActivityStore', () => {
  it('keeps the newest entries up to the cap and persists them', () => {
    const path = dir()
    const store = new ActivityStore(path, 3)
    ;[1, 5, 3, 4, 2].forEach((at) => store.record(entry(`e${at}`, at)))
    expect(store.list('s1').map((e) => e.id)).toEqual(['e5', 'e4', 'e3'])
    expect(new ActivityStore(path, 3).list('s1').map((e) => e.id)).toEqual(['e5', 'e4', 'e3'])
    expect(readdirSync(path)).toEqual(['s1.json'])
  })

  it('replaces an entry with the same id', () => {
    const store = new ActivityStore(dir())
    store.record(entry('a', 1, { status: 'running' }))
    store.record(entry('a', 1, { status: 'failed' }))
    expect(store.list('s1')).toMatchObject([{ id: 'a', status: 'failed' }])
  })

  it('filters by area, status, text, time and limit', () => {
    const store = new ActivityStore(dir())
    store.record(entry('a', 1, { area: 'docker' }))
    store.record(entry('b', 2, { status: 'failed' }))
    store.record(entry('c', 3, { steps: [{ label: 'Reload', display: 'systemctl reload nginx', output: '', exitCode: 0, status: 'done' }] }))
    expect(store.list('s1', { area: 'docker' }).map((e) => e.id)).toEqual(['a'])
    expect(store.list('s1', { status: 'failed' }).map((e) => e.id)).toEqual(['b'])
    expect(store.list('s1', { text: 'RELOAD' }).map((e) => e.id)).toEqual(['c'])
    expect(store.list('s1', { before: 3 }).map((e) => e.id)).toEqual(['b', 'a'])
    expect(store.list('s1', { limit: 1 }).map((e) => e.id)).toEqual(['c'])
  })

  it('keeps sessions apart and hashes unsafe keys into file names', () => {
    const path = dir()
    const store = new ActivityStore(path)
    store.record(entry('a', 1, { sessionKey: '../escape' }))
    expect(store.list('s1')).toEqual([])
    expect(store.list('../escape')).toHaveLength(1)
    expect(readdirSync(path)[0]).toMatch(/^[0-9a-f]{64}\.json$/)
    expect(existsSync(join(path, '..', 'escape.json'))).toBe(false)
  })
})

describe('activity entries', () => {
  it('turns a run into an entry with capped output', () => {
    const run = {
      id: 'r1', planId: 'p1', connectionId: 'c1', sessionKey: 's1', type: 'software.install', area: 'software' as const, title: 'Install nginx',
      status: 'done' as const, startedAt: 1000, finishedAt: 4000, failure: null,
      steps: [{ id: 'one', label: 'Install', display: 'apt-get install nginx', status: 'done' as const, startedAt: 1000, finishedAt: 4000, exitCode: 0, output: 'x'.repeat(MAX_ACTIVITY_OUTPUT + 10) }]
    }
    const result = entryFromRun(run)
    expect(result).toMatchObject({ id: 'action:r1', at: 1000, durationMs: 3000, who: 'you', source: 'action' })
    expect(result.steps[0].output).toHaveLength(MAX_ACTIVITY_OUTPUT)
  })

  it('mirrors finished deploys, automatic ones as auto', () => {
    const deploy: DeployRecord = { id: 'd1', status: 'failed', trigger: 'auto', commit: 'abc', started: 100, finished: 130, warnings: 0, note: 'build failed', subject: '' }
    expect(entryFromDeploy('s1', 'app', deploy)).toMatchObject({ id: 'deploy:app:d1', at: 100_000, durationMs: 30_000, who: 'auto', source: 'deploy', area: 'sites', status: 'failed', failure: { message: 'build failed' } })
    expect(entryFromDeploy('s1', 'app', { ...deploy, trigger: 'manual', status: 'success' })).toMatchObject({ who: 'you', status: 'done', title: 'Deploy app', failure: null })
    expect(entryFromDeploy('s1', 'app', { ...deploy, status: 'running' })).toBeNull()
  })

  it('mirrors finished Create site runs', () => {
    const record = { id: 'cs1', sessionId: 's1', domain: 'app.example.com', createdAt: 1000, phase: 'failed', current: 'https', error: 'Certificate failed', steps: [{ id: 'site-file', status: 'done', startedAt: 1, finishedAt: 2 }] } as unknown as RunRecord
    expect(entryFromCreateSite(record, 6000)).toMatchObject({ id: 'create-site:cs1:failed', source: 'create-site', title: 'Create site app.example.com', durationMs: 5000, status: 'failed', failure: { stepId: 'https', message: 'Certificate failed' }, steps: [{ label: 'Site file', status: 'done' }] })
    expect(entryFromCreateSite({ ...record, phase: 'running' }, 6000)).toBeNull()
  })
})
