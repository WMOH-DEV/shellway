import { describe, expect, it } from 'vitest'
import type { RunRecord, RunStep } from '@/types/createSite'
import { isUnfinished, latestUnfinished, progressState, stepPosition, stepSeconds } from './runView'
import { baseInput } from './testFixtures'

const step = (id: RunStep['id'], status: RunStep['status'], startedAt: number | null = null, finishedAt: number | null = null): RunStep => ({ id, status, startedAt, finishedAt })

const record = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  id: 'run-1',
  sessionId: 'session-1',
  domain: 'shop.example.com',
  createdAt: 1_000,
  server: { kind: 'nginx' },
  input: baseInput(),
  steps: [step('folder', 'done', 1_000, 2_000), step('site', 'pending', 2_000), step('dns', 'pending')],
  created: { folder: null, repo: null, localCopy: null, siteFile: null, phpPool: null, database: null, envFile: null, jobs: null, modulesEnabled: [], dnsRecords: [], httpsSiteFile: null, certificate: null, deploySite: null },
  phase: 'running',
  current: 'site',
  error: null,
  deployKey: null,
  ...overrides
})

describe('progressState', () => {
  it('marks only the current step of a running run as running', () => {
    const run = record()
    expect(run.steps.map((s) => progressState(s, run))).toEqual(['done', 'running', 'waiting'])
  })

  it('shows nothing running once the run stopped', () => {
    const run = record({ phase: 'stopped' })
    expect(progressState(run.steps[1], run)).toBe('waiting')
  })
})

describe('stepSeconds', () => {
  it('counts finished steps to their end and running steps to now', () => {
    expect(stepSeconds(step('folder', 'done', 1_000, 3_400), 9_000)).toBe(2)
    expect(stepSeconds(step('site', 'pending', 1_000), 6_000)).toBe(5)
    expect(stepSeconds(step('dns', 'pending'), 6_000)).toBeNull()
  })
})

describe('stepPosition', () => {
  it('counts from the current step, or the steps reached', () => {
    expect(stepPosition(record())).toBe('step 2 of 3')
    expect(stepPosition(record({ current: null }))).toBe('step 1 of 3')
  })
})

describe('unfinished runs', () => {
  it('keeps every run that is not done or removed, newest first', () => {
    expect(isUnfinished(record({ phase: 'remove-failed' }))).toBe(true)
    expect(isUnfinished(record({ phase: 'removed' }))).toBe(false)
    const older = record({ id: 'run-old', phase: 'failed', createdAt: 1 })
    const newer = record({ id: 'run-new', phase: 'stopped', createdAt: 2 })
    expect(latestUnfinished([older, record({ phase: 'done', createdAt: 3 }), newer])?.id).toBe('run-new')
    expect(latestUnfinished([record({ phase: 'done' })])).toBeNull()
  })
})
