import { createHash } from 'crypto'
import type { ActionDefinition, ActionPlan, ActionPlanView, ActionRun, ProbeResult, RunStartResult, ServerFacts } from '../../../src/types/server/core'
import { IDENTITY_PROBE, SUDO_PROBE, type ServerIdentity, type SudoAccess } from '../../../src/types/server/identity'
import { findAction } from '../../../src/utils/server/areas'
import type { RemoteExec } from '../deploy/DeployService'
import type { ActivityStore } from './ActivityStore'
import { entryFromRun } from './activityEntries'
import { DetachedSteps } from './DetachedSteps'
import { remoteFor } from './remote'
import { RunExecution, type ExecutionDeps } from './RunExecution'
import type { RunStore, StoredRun } from './RunStore'
import type { ScanService } from './ScanService'
import { redact, usableSecrets } from './StepOutput'

export const PLAN_TTL_MS = 10 * 60_000
const RECENT_RUNS = 20
const MAX_STEP_SECONDS = 24 * 60 * 60
const OUTPUT_THROTTLE_MS = 100
const CLOSED_MID_STEP = 'Shellway closed during this step. Check the server before running it again.'

export interface EngineDeps {
  execFor(connectionId: string): RemoteExec | null
  scan: Pick<ScanService, 'scan'>
  store: RunStore
  activity: Pick<ActivityStore, 'record'>
  broadcast(channel: string, ...args: unknown[]): void
  newId(): string
  now(): number
  sleep(ms: number): Promise<void>
  findAction?(type: string): ActionDefinition | undefined
  throttleMs?: number
}

interface StoredPlan {
  connectionId: string
  type: string
  params: unknown
  plan: ActionPlan
  scriptsHash: string
  expiresAt: number
}

function scriptsHash(plan: ActionPlan): string {
  const material = plan.steps.map((step) => [step.id, step.root, step.script, step.rollback ?? null, step.timeoutSeconds, step.detached ?? false, step.cleanExits ?? []])
  return createHash('sha256').update(JSON.stringify([material, plan.blocked])).digest('hex')
}

function assertPlan(plan: ActionPlan): void {
  const ids = new Set(plan.steps.map((step) => step.id))
  if (ids.size !== plan.steps.length) throw new Error('The plan has two steps with the same id')
  const bad = plan.steps.find((step) => !Number.isInteger(step.timeoutSeconds) || step.timeoutSeconds < 1 || step.timeoutSeconds > MAX_STEP_SECONDS)
  if (bad) throw new Error(`Invalid time limit for "${bad.label}"`)
}

function planView(planId: string, type: string, plan: ActionPlan, expiresAt: number): ActionPlanView {
  const secrets = usableSecrets(plan.secrets)
  return {
    planId,
    type,
    title: plan.title,
    area: plan.area,
    summary: plan.summary,
    steps: plan.steps.map((step) => ({
      id: step.id,
      label: step.label,
      ...(step.group && { group: step.group }),
      kind: step.kind,
      root: step.root,
      display: redact(step.display, secrets),
      ...(step.diff !== undefined && { diff: redact(step.diff, secrets) }),
      detached: step.detached === true,
      reversible: Boolean(step.rollback)
    })),
    warnings: plan.warnings,
    blocked: plan.blocked,
    expiresAt
  }
}

const okData = <T>(result: ProbeResult | undefined): T | null => (result?.status === 'ok' ? (result.data as T) : null)

function sudoProblem(result: ProbeResult | undefined): { reason: string; installed: boolean } | null {
  if (!result) return { reason: 'Could not check sudo', installed: true }
  if (result.status === 'unavailable') return { reason: result.reason, installed: true }
  if (result.status === 'error') return { reason: `Could not check sudo: ${result.error}`, installed: true }
  const access = result.data as SudoAccess
  return access.passwordless ? null : { reason: access.reason, installed: access.available }
}

export function sudoHint(reason: string, installed: boolean, user: string): string {
  const allow = `run "sudo visudo -f /etc/sudoers.d/shellway" on the server and add this line:\n${user || 'your-user'} ALL=(ALL) NOPASSWD:ALL`
  const how = installed ? `To allow it, ${allow}` : `Install sudo as root first. Then ${allow}`
  return `${reason}. Shellway changes the server with "sudo -n", which cannot type a password. ${how}`
}

function withUnreadableBlock(plan: ActionPlan): ActionPlan {
  const path = plan.blocked ? undefined : plan.steps.find((step) => step.unreadableFile)?.unreadableFile
  if (!path) return plan
  return { ...plan, blocked: { kind: 'precondition', message: `${path} has characters Shellway cannot read safely. Edit it by hand.` } }
}

function withSudoBlock(plan: ActionPlan, facts: ServerFacts): ActionPlan {
  if (plan.blocked || !plan.steps.some((step) => step.root)) return plan
  const problem = sudoProblem(facts[SUDO_PROBE])
  if (!problem) return plan
  const user = okData<ServerIdentity>(facts[IDENTITY_PROBE])?.user ?? ''
  return { ...plan, blocked: { kind: 'sudo', message: sudoHint(problem.reason, problem.installed, user) } }
}

function crashed(record: StoredRun, now: number): StoredRun {
  const running = record.run.steps.find((step) => step.status === 'running')
  const steps = record.run.steps.map((step) => {
    if (step === running) return { ...step, status: 'failed' as const, finishedAt: now }
    return step.status === 'pending' ? { ...step, status: 'skipped' as const } : step
  })
  const failure = { kind: 'lost' as const, stepId: running?.id ?? null, message: CLOSED_MID_STEP }
  return { ...record, detached: null, run: { ...record.run, steps, status: 'failed', failure, finishedAt: now } }
}

export class ActionEngine {
  private readonly plans = new Map<string, StoredPlan>()
  private readonly executions = new Map<string, RunExecution>()
  private readonly claims = new Map<string, string>()
  private readonly sessions = new Map<string, string>()
  private readonly detached: DetachedSteps

  constructor(private readonly deps: EngineDeps) {
    this.detached = new DetachedSteps({ now: deps.now, sleep: deps.sleep })
  }

  recover(): void {
    for (const record of this.deps.store.all()) {
      if (record.run.status !== 'running') continue
      const followable = record.detached !== null && record.run.steps.some((step) => step.status === 'running')
      if (!followable) this.finished(crashed(record, this.deps.now()))
    }
  }

  async plan(connectionId: string, type: string, raw: unknown): Promise<ActionPlanView> {
    const definition = this.definition(type)
    const params = definition.validate(raw)
    const plan = await this.build(connectionId, definition, params)
    return this.remember(connectionId, type, params, plan)
  }

  async run(connectionId: string, sessionKey: string, planId: string): Promise<RunStartResult> {
    const stored = this.storedPlan(connectionId, planId)
    if (stored.plan.blocked) throw new Error(stored.plan.blocked.message)
    this.sessions.set(connectionId, sessionKey)
    const busy = this.busyRun(connectionId, sessionKey)
    if (busy) return { kind: 'busy', runId: busy }
    const runId = this.deps.newId()
    const keys = [`connection:${connectionId}`, `session:${sessionKey}`]
    keys.forEach((key) => this.claims.set(key, runId))
    try {
      const fresh = await this.build(connectionId, this.definition(stored.type), stored.params)
      this.plans.delete(planId)
      if (fresh.blocked || scriptsHash(fresh) !== stored.scriptsHash) return { kind: 'stale', plan: this.remember(connectionId, stored.type, stored.params, fresh) }
      return { kind: 'started', run: this.start(runId, planId, connectionId, sessionKey, stored.type, fresh) }
    } finally {
      keys.forEach((key) => this.claims.delete(key))
    }
  }

  stop(runId: string): void {
    const execution = this.executions.get(runId)
    if (!execution) throw new Error('This action is not running.')
    execution.requestStop()
  }

  runs(connectionId: string): ActionRun[] {
    return this.forConnection(connectionId, this.sessions.get(connectionId)).slice(0, RECENT_RUNS).map((record) => record.run)
  }

  reattach(connectionId: string, sessionKey?: string): void {
    if (sessionKey) this.sessions.set(connectionId, sessionKey)
    for (const execution of this.executions.values()) {
      if (execution.isParked && (execution.run.connectionId === connectionId || execution.run.sessionKey === sessionKey)) execution.resume(connectionId)
    }
    for (const record of this.forConnection(connectionId, sessionKey)) {
      if (record.run.status !== 'running' || !record.detached || this.executions.has(record.run.id)) continue
      record.run.connectionId = connectionId
      this.publish(record)
      this.launch(record, null)
    }
  }

  forget(connectionId: string): void {
    this.detached.forget(connectionId)
  }

  private definition(type: string): ActionDefinition {
    const definition = (this.deps.findAction ?? findAction)(type)
    if (!definition) throw new Error(`Unknown action: ${type}`)
    return definition
  }

  private async build(connectionId: string, definition: ActionDefinition, params: unknown): Promise<ActionPlan> {
    const facts = await this.deps.scan.scan(connectionId, [...new Set([...definition.needs, SUDO_PROBE, IDENTITY_PROBE])], true)
    const plan = definition.plan(params, facts)
    assertPlan(plan)
    return withSudoBlock(withUnreadableBlock(plan), facts)
  }

  private remember(connectionId: string, type: string, params: unknown, plan: ActionPlan): ActionPlanView {
    const now = this.deps.now()
    for (const [id, stored] of this.plans) if (stored.expiresAt <= now) this.plans.delete(id)
    const planId = this.deps.newId()
    const expiresAt = now + PLAN_TTL_MS
    this.plans.set(planId, { connectionId, type, params, plan, scriptsHash: scriptsHash(plan), expiresAt })
    return planView(planId, type, plan, expiresAt)
  }

  private storedPlan(connectionId: string, planId: string): StoredPlan {
    const stored = this.plans.get(planId)
    if (!stored || stored.expiresAt <= this.deps.now()) {
      this.plans.delete(planId)
      throw new Error('This plan expired. Review it again.')
    }
    if (stored.connectionId !== connectionId) throw new Error('This plan belongs to a different connection.')
    return stored
  }

  private busyRun(connectionId: string, sessionKey: string): string | null {
    const claimed = this.claims.get(`connection:${connectionId}`) ?? this.claims.get(`session:${sessionKey}`)
    if (claimed) return claimed
    return this.forConnection(connectionId, sessionKey).find((record) => record.run.status === 'running')?.run.id ?? null
  }

  private forConnection(connectionId: string, sessionKey: string | undefined): StoredRun[] {
    return this.deps.store.all().filter((record) => record.run.connectionId === connectionId || (sessionKey !== undefined && record.run.sessionKey === sessionKey))
  }

  private start(runId: string, planId: string, connectionId: string, sessionKey: string, type: string, plan: ActionPlan): ActionRun {
    const secrets = usableSecrets(plan.secrets)
    const run: ActionRun = {
      id: runId,
      planId,
      connectionId,
      sessionKey,
      type,
      area: plan.area,
      title: plan.title,
      status: 'running',
      startedAt: this.deps.now(),
      finishedAt: null,
      steps: plan.steps.map((step) => ({ id: step.id, label: step.label, ...(step.group && { group: step.group }), display: redact(step.display, secrets), status: 'pending', startedAt: null, finishedAt: null, exitCode: null, output: '' })),
      failure: null,
      ...(plan.undo && { undo: plan.undo })
    }
    const record: StoredRun = { run, detached: null, state: {}, hasSecrets: secrets.length > 0 }
    this.publish(record)
    const snapshot = structuredClone(run)
    this.launch(record, plan)
    return snapshot
  }

  private launch(record: StoredRun, plan: ActionPlan | null): void {
    const execution = new RunExecution(record, plan, this.executionDeps())
    this.executions.set(record.run.id, execution)
    void execution.execute()
  }

  private executionDeps(): ExecutionDeps {
    return {
      remote: (connectionId) => remoteFor(this.deps, connectionId),
      detached: this.detached,
      save: (record) => this.deps.store.save(record),
      publish: (record) => this.publish(record),
      output: (chunk) => this.deps.broadcast('server:run-output', chunk),
      finish: (record) => this.finished(record),
      now: this.deps.now,
      throttleMs: this.deps.throttleMs ?? OUTPUT_THROTTLE_MS
    }
  }

  private publish(record: StoredRun): void {
    this.deps.store.save(record)
    this.deps.broadcast('server:run-update', record.run)
  }

  private finished(record: StoredRun): void {
    try {
      this.deps.activity.record(entryFromRun(record.run))
    } catch (err) {
      console.warn(`[server] could not record activity: ${(err as Error).message}`)
    }
    this.executions.delete(record.run.id)
    this.publish(record)
  }
}
