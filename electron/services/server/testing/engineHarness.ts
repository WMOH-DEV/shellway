import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { vi } from 'vitest'
import type { ActionDefinition, ActionPlan, ActionRun, ActionStep, RunOutputChunk, ServerFacts } from '../../../../src/types/server/core'
import { ActionEngine } from '../ActionEngine'
import { ActivityStore } from '../ActivityStore'
import { RunStore } from '../RunStore'
import { FakeRemoteExec } from './FakeRemoteExec'

export const step = (id: string, overrides: Partial<ActionStep> = {}): ActionStep => ({
  id,
  label: `Step ${id}`,
  kind: 'command',
  root: false,
  script: `run-${id}`,
  display: `run-${id}`,
  timeoutSeconds: 30,
  ...overrides
})

export function action(type: string, steps: (params: unknown) => ActionStep[], extra: Partial<ActionPlan> = {}): ActionDefinition {
  return {
    type,
    area: 'software',
    needs: ['software.packages'],
    validate: (raw) => raw,
    plan: (params) => ({ title: `Do ${type}`, area: 'software', summary: '', steps: steps(params), warnings: [], blocked: null, secrets: [], ...extra })
  }
}

export function facts(sudo: 'ok' | 'password' = 'ok'): ServerFacts {
  return {
    'core.sudo': { status: 'ok', data: { available: true, passwordless: sudo === 'ok', reason: sudo === 'ok' ? '' : 'Needs passwordless sudo for deploy' }, at: 1 },
    'core.identity': { status: 'ok', data: { user: 'deploy' }, at: 1 }
  }
}

export interface Harness {
  engine: ActionEngine
  fake: FakeRemoteExec
  broadcast: ReturnType<typeof vi.fn>
  dir: string
  store: RunStore
  activity: ActivityStore
  scan: { scan: ReturnType<typeof vi.fn> }
  setConnected(value: boolean): void
  tick(ms: number): void
  finished(runId: string): Promise<ActionRun>
  updates(runId: string): ActionRun[]
  outputs(runId: string, stepId?: string): string
  events(): string[]
}

export function harness(actions: ActionDefinition[], options: { dir?: string; sudo?: 'ok' | 'password' } = {}): Harness {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'shellway-engine-'))
  const fake = new FakeRemoteExec()
  const log: Array<[string, unknown]> = []
  const broadcast = vi.fn((channel: string, ...args: unknown[]) => { log.push([channel, structuredClone(args[0])]) })
  const store = new RunStore(join(dir, 'runs.json'))
  const activity = new ActivityStore(join(dir, 'activity'))
  const recordActivity = activity.record.bind(activity)
  activity.record = (entry) => {
    log.push(['activity', entry.id])
    recordActivity(entry)
  }
  const scan = { scan: vi.fn(async () => facts(options.sudo)) }
  let connected = true
  let clock = 1_000_000
  let ids = 0
  const engine = new ActionEngine({
    execFor: () => (connected ? fake.exec : null),
    scan,
    store,
    activity,
    broadcast,
    newId: () => `id-${++ids}`,
    now: () => clock,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 0)),
    findAction: (type) => actions.find((candidate) => candidate.type === type),
    throttleMs: 0
  })
  const updates = (runId: string) => log.filter(([channel, run]) => channel === 'server:run-update' && (run as ActionRun).id === runId).map(([, run]) => run as ActionRun)
  const chunks = () => log.filter(([channel]) => channel === 'server:run-output').map(([, chunk]) => chunk as RunOutputChunk)
  return {
    engine,
    fake,
    broadcast,
    dir,
    store,
    activity,
    scan,
    setConnected: (value) => { connected = value },
    tick: (ms) => { clock += ms },
    updates,
    finished: async (runId) => {
      await vi.waitFor(() => {
        if (!updates(runId).some((run) => run.status !== 'running')) throw new Error('still running')
      })
      return updates(runId).at(-1) as ActionRun
    },
    outputs: (runId, stepId) => chunks().filter((chunk) => chunk.runId === runId && (!stepId || chunk.stepId === stepId)).map((chunk) => chunk.chunk).join(''),
    events: () => log.map(([channel, payload]) => (channel === 'server:run-update' ? `update:${(payload as ActionRun).status}` : channel === 'server:run-output' ? 'output' : channel))
  }
}
