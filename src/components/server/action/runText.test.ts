import { describe, expect, it } from 'vitest'
import type { ActionRun, RunStepState } from '@/types/server/core'
import { appendCapped } from '@/stores/serverActionStore'
import { failedStep, failureDetail, failureHeadline, focusStep } from './runText'

const step = (id: string, status: RunStepState['status']): RunStepState =>
  ({ id, label: id, display: id, status, startedAt: null, finishedAt: null, exitCode: null, output: '' })

const run = (overrides: Partial<ActionRun>): ActionRun => ({
  id: 'run-1', planId: 'plan-1', connectionId: 'c', sessionKey: 's', type: 't', area: 'software', title: 'T',
  status: 'failed', startedAt: 0, finishedAt: 1, steps: [], failure: null, ...overrides
})

describe('failure text', () => {
  it.each([
    ['sudo', 'This step needs passwordless sudo, and sudo asked for a password.'],
    ['timeout', 'This step took too long and was stopped.'],
    ['disconnect', 'The connection to the server dropped during this step.'],
    ['changed', 'The file changed on the server since you reviewed; review again.'],
    ['lost', 'Shellway lost track of this action. Check the server before running it again.']
  ] as const)('explains a %s failure in plain words', (kind, text) => {
    expect(failureHeadline(run({ failure: { kind, stepId: null, message: 'x' } }))).toBe(text)
  })

  it('treats stopped and lost runs by their status', () => {
    expect(failureHeadline(run({ status: 'stopped' }))).toBe('Stopped. The finished steps stay as they are.')
    expect(failureHeadline(run({ status: 'lost' }))).toMatch(/lost track/)
  })

  it('shows the engine message only when it adds something', () => {
    expect(failureDetail(run({ failure: { kind: 'exit', stepId: null, message: '  exit 100  ' } }))).toBe('exit 100')
    expect(failureDetail(run({ failure: { kind: 'exit', stepId: null, message: '' } }))).toBeNull()
  })

  it('finds the failed step by id, then by status', () => {
    const steps = [step('a', 'done'), step('b', 'failed'), step('c', 'skipped')]
    expect(failedStep(run({ steps, failure: { kind: 'exit', stepId: 'a', message: '' } }))?.id).toBe('a')
    expect(failedStep(run({ steps }))?.id).toBe('b')
  })

  it('focuses the running step, else the last one that started', () => {
    expect(focusStep([step('a', 'done'), step('b', 'running'), step('c', 'pending')])?.id).toBe('b')
    expect(focusStep([step('a', 'done'), step('b', 'failed'), step('c', 'pending')])?.id).toBe('b')
    expect(focusStep([step('a', 'pending')])).toBeUndefined()
  })
})

describe('appendCapped', () => {
  it('drops the head once output passes the limit', () => {
    expect(appendCapped('abc', 'def', 4)).toBe('cdef')
    expect(appendCapped('ab', 'c', 4)).toBe('abc')
  })
})
