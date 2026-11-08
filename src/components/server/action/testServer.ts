import { act } from '@testing-library/react'
import { vi } from 'vitest'
import type { ActionPlanView, ActionRun, RunOutputChunk, RunStepState, ServerFacts } from '@/types/server/core'

const runListeners = new Set<(run: ActionRun) => void>()
const outputListeners = new Set<(output: RunOutputChunk) => void>()
const factsListeners = new Set<(connectionId: string, facts: ServerFacts) => void>()

function listener<T extends (...args: never[]) => void>(set: Set<T>) {
  return (callback: T) => {
    set.add(callback)
    return () => set.delete(callback)
  }
}

export function makePlan(overrides: Partial<ActionPlanView> = {}): ActionPlanView {
  return {
    planId: 'plan-1',
    type: 'software.install',
    title: 'Install Redis',
    area: 'software',
    summary: 'Installs redis-server from the Ubuntu archive.',
    steps: [
      { id: 'install', label: 'Install redis-server', kind: 'command', root: true, display: 'apt-get install -y redis-server', detached: true, reversible: false },
      { id: 'config', label: 'Set maxmemory', kind: 'file-edit', root: true, display: 'write /etc/redis/redis.conf', diff: '--- a/redis.conf\n+++ b/redis.conf\n@@ -1,2 +1,2 @@\n-maxmemory 0\n+maxmemory 256mb', detached: false, reversible: true }
    ],
    warnings: [],
    blocked: null,
    expiresAt: Date.now() + 60_000,
    ...overrides
  }
}

export function runStep(id: string, label: string, status: RunStepState['status'], output = ''): RunStepState {
  const finished = status === 'done' || status === 'failed' || status === 'rolled-back'
  return { id, label, display: label, status, startedAt: status === 'pending' ? null : 1_000, finishedAt: finished ? 3_000 : null, exitCode: null, output }
}

export function makeRun(overrides: Partial<ActionRun> = {}): ActionRun {
  return {
    id: 'run-1',
    planId: 'plan-1',
    connectionId: 'conn-1',
    sessionKey: 'session-1',
    type: 'software.install',
    area: 'software',
    title: 'Install Redis',
    status: 'running',
    startedAt: 1_000,
    finishedAt: null,
    steps: [runStep('install', 'Install redis-server', 'running'), runStep('config', 'Set maxmemory', 'pending')],
    failure: null,
    ...overrides
  }
}

export function installFakeServer(overrides: Record<string, unknown> = {}) {
  const server = {
    plan: vi.fn().mockResolvedValue({ success: true, data: makePlan() }),
    run: vi.fn().mockResolvedValue({ success: true, data: { kind: 'started', run: makeRun() } }),
    stop: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    runs: vi.fn().mockResolvedValue({ success: true, data: [] }),
    scan: vi.fn().mockResolvedValue({ success: true, data: {} }),
    facts: vi.fn().mockResolvedValue({ success: true, data: {} }),
    onRun: listener(runListeners),
    onOutput: listener(outputListeners),
    onFacts: listener(factsListeners),
    ...overrides
  }
  Object.assign(window, { novadeck: { server } })
  return server
}

export const emitRun = (run: ActionRun) => act(() => runListeners.forEach((callback) => callback(run)))

export const emitOutput = (output: RunOutputChunk) => act(() => outputListeners.forEach((callback) => callback(output)))

export const emitFacts = (connectionId: string, facts: ServerFacts) => act(() => factsListeners.forEach((callback) => callback(connectionId, facts)))
