import type { ActionPlan, ActionRun, ActionStep, RunFailure, RunOutputChunk, RunStatus, RunStepState } from '../../../src/types/server/core'
import { EXIT_FILE_CHANGED } from '../../../src/utils/server/fileEdit'
import type { RemoteExec } from '../deploy/DeployService'
import { ExecTimeoutError } from '../../utils/sshExec'
import type { DetachedRef, DetachedSteps } from './DetachedSteps'
import { Disconnected, isSudoFailure, lastLine, limitedShell, stepInput, TIMEOUT_EXITS } from './remote'
import type { StoredRun } from './RunStore'
import { redact, StepOutput, type OutputCarry } from './StepOutput'

const KILL_AFTER_SECONDS = 10
const EXEC_MARGIN_SECONDS = 20
const ATTACHED_OUTPUT_LIMIT = 64 * 1024
const SAVE_EVERY_MS = 10_000
const NO_EXIT_CODE = -1
const WATCH_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 15_000]

const RESTARTED = 'Shellway restarted during this action, so the steps after the long one did not run. Run the action again.'
const OUTPUT_HIDDEN = '\nShellway restarted, so it can no longer hide the secrets in this output. The rest of it is not shown.\n'
const LOST = 'The step stopped on the server without reporting a result. Check the server before running it again.'

type StepOutcome =
  | { kind: 'exit'; code: number }
  | { kind: 'timeout' }
  | { kind: 'disconnect' }
  | { kind: 'lost' }
  | { kind: 'error'; message: string }

export interface ExecutionDeps {
  remote(connectionId: () => string): RemoteExec
  detached: DetachedSteps
  save(record: StoredRun): void
  publish(record: StoredRun): void
  output(chunk: RunOutputChunk): void
  finish(record: StoredRun): void
  now(): number
  throttleMs: number
}

export class RunExecution {
  private stopRequested = false
  private wakeUp: (() => void) | null = null
  private lastSave = 0
  private readonly exec: RemoteExec

  constructor(private readonly record: StoredRun, private readonly plan: ActionPlan | null, private readonly deps: ExecutionDeps) {
    this.exec = deps.remote(() => this.record.run.connectionId)
  }

  get run(): ActionRun {
    return this.record.run
  }

  get isParked(): boolean {
    return this.wakeUp !== null
  }

  resume(connectionId: string): void {
    const wakeUp = this.wakeUp
    if (!wakeUp) return
    this.wakeUp = null
    this.record.run.connectionId = connectionId
    wakeUp()
  }

  requestStop(): void {
    this.stopRequested = true
    const ref = this.record.detached
    if (ref && !this.isParked) void this.deps.detached.kill(this.exec, ref).catch(() => undefined)
  }

  async execute(): Promise<void> {
    try {
      await this.executeSteps()
    } catch (err) {
      this.complete('failed', { kind: 'error', stepId: null, message: (err as Error).message })
    }
  }

  private async executeSteps(): Promise<void> {
    const steps = this.run.steps
    for (let index = this.firstStep(); index < steps.length; index++) {
      if (this.stopRequested) return this.stopBefore(index)
      const failure = await this.runStep(index)
      if (failure) return this.fail(index, failure)
    }
    this.complete('done', null)
  }

  private firstStep(): number {
    const running = this.run.steps.findIndex((step) => step.status === 'running')
    return running >= 0 ? running : Math.max(0, this.run.steps.findIndex((step) => step.status === 'pending'))
  }

  private planStep(index: number): ActionStep | null {
    return this.plan?.steps[index] ?? null
  }

  private secrets(): string[] {
    return this.plan?.secrets ?? []
  }

  private outputFor(state: RunStepState, carry?: OutputCarry): StepOutput {
    const output: StepOutput = new StepOutput(this.secrets(), (chunk) => {
      state.output = output.text
      this.deps.output({ runId: this.run.id, stepId: state.id, chunk })
    }, this.deps.throttleMs, state.output, carry)
    return output
  }

  private async runStep(index: number): Promise<RunFailure | null> {
    const state = this.run.steps[index]
    const resuming = state.status === 'running' && this.record.detached !== null
    if (!resuming) {
      Object.assign(state, { status: 'running', startedAt: this.deps.now() })
      this.deps.publish(this.record)
    }
    const output = this.outputFor(state, resuming ? this.record.detached?.carry : undefined)
    const outcome = await this.outcomeOf(index, output, resuming)
    output.flush()
    state.output = output.text
    this.record.state[state.id] = { ...this.record.state[state.id], ...output.state }
    this.record.detached = null
    const failure = this.failureFor(index, outcome, output.text)
    Object.assign(state, { status: failure ? 'failed' : 'done', finishedAt: this.deps.now(), exitCode: outcome.kind === 'exit' && outcome.code !== NO_EXIT_CODE ? outcome.code : null })
    if (!failure) this.deps.publish(this.record)
    return failure
  }

  private async outcomeOf(index: number, output: StepOutput, resuming: boolean): Promise<StepOutcome> {
    try {
      if (resuming) return await this.followDetached(output, this.run.steps[index])
      const step = this.planStep(index)
      if (!step) return { kind: 'error', message: RESTARTED }
      return step.detached ? await this.startDetached(index, step, output) : await this.runAttached(step, output)
    } catch (err) {
      if (err instanceof Disconnected) return { kind: 'disconnect' }
      if (err instanceof ExecTimeoutError) return { kind: 'timeout' }
      return { kind: 'error', message: (err as Error).message }
    }
  }

  private async runAttached(step: ActionStep, output: StepOutput): Promise<StepOutcome> {
    const result = await this.exec(limitedShell(step.root, step.timeoutSeconds, KILL_AFTER_SECONDS), {
      stdin: stepInput(this.run.id, step.script),
      timeoutMs: (step.timeoutSeconds + EXEC_MARGIN_SECONDS) * 1000,
      onOutput: (chunk) => output.push(chunk),
      maxOutputBytes: ATTACHED_OUTPUT_LIMIT
    })
    return { kind: 'exit', code: result.code }
  }

  private async startDetached(index: number, step: ActionStep, output: StepOutput): Promise<StepOutcome> {
    await this.deps.detached.ensureRunner(this.exec, this.run.connectionId)
    const started = await this.launch(index, step)
    if (!started) return { kind: 'lost' }
    this.record.detached = started
    this.deps.save(this.record)
    return this.followDetached(output, this.run.steps[index])
  }

  private async launch(index: number, step: ActionStep): Promise<DetachedRef | null> {
    try {
      return await this.deps.detached.start(this.exec, `${this.run.id}-${index}`, step.root, step.timeoutSeconds, stepInput(this.run.id, step.script))
    } catch (err) {
      if (err instanceof ExecTimeoutError) return null
      throw err
    }
  }

  private async followDetached(output: StepOutput, state: RunStepState): Promise<StepOutcome> {
    const ref = this.record.detached
    if (!ref) return { kind: 'lost' }
    const hidden = this.plan === null && this.record.hasSecrets
    if (hidden) output.conceal(OUTPUT_HIDDEN)
    const checkpoint = () => {
      state.output = output.text
      ref.carry = output.carry()
    }
    const watch = {
      onChunk: (chunk: string) => (hidden ? output.observe(chunk) : output.push(chunk)),
      onProgress: () => {
        checkpoint()
        this.saveNowAndThen()
      },
      stopRequested: () => this.stopRequested
    }
    let failures = 0
    for (;;) {
      try {
        return await this.deps.detached.follow(this.exec, ref, watch)
      } catch (err) {
        if (err instanceof Disconnected) {
          failures = 0
          checkpoint()
          await this.parkUntilResumed()
        } else {
          if (this.deps.detached.isPastDeadline(ref)) return this.abandon(ref)
          await this.deps.detached.pause(WATCH_RETRY_DELAYS_MS[Math.min(failures++, WATCH_RETRY_DELAYS_MS.length - 1)])
        }
      }
    }
  }

  private async parkUntilResumed(): Promise<void> {
    this.deps.save(this.record)
    await new Promise<void>((resolve) => { this.wakeUp = resolve })
  }

  private async abandon(ref: DetachedRef): Promise<StepOutcome> {
    await this.deps.detached.kill(this.exec, ref).catch(() => undefined)
    return { kind: 'lost' }
  }

  private saveNowAndThen(): void {
    if (this.deps.now() - this.lastSave < SAVE_EVERY_MS) return
    this.lastSave = this.deps.now()
    this.deps.save(this.record)
  }

  private failureFor(index: number, outcome: StepOutcome, text: string): RunFailure | null {
    const state = this.run.steps[index]
    const failure = (kind: RunFailure['kind'], message: string): RunFailure => ({ kind, stepId: state.id, message })
    switch (outcome.kind) {
      case 'exit':
        return outcome.code === 0 ? null : failure(...this.exitFailure(index, outcome.code, text))
      case 'timeout':
        return failure('timeout', this.tookTooLong(index))
      case 'disconnect':
        return failure('disconnect', `The connection dropped during "${state.label}". It may have finished on the server. Check before running it again.`)
      case 'lost':
        return failure('lost', LOST)
      case 'error':
        return failure('error', outcome.message)
    }
  }

  private exitFailure(index: number, code: number, text: string): [RunFailure['kind'], string] {
    const label = this.run.steps[index].label
    const step = this.planStep(index)
    const last = lastLine(text)
    if ((step?.root ?? true) && isSudoFailure(text)) return ['sudo', last]
    if (code === EXIT_FILE_CHANGED) return ['changed', last || `The file changed since you reviewed it. Nothing was written.`]
    if (step?.cleanExits?.includes(code)) return ['exit', last || `"${label}" stopped without changing anything.`]
    if (TIMEOUT_EXITS.has(code)) return ['timeout', this.tookTooLong(index)]
    if (code === NO_EXIT_CODE) return ['error', `"${label}" ended without reporting a result.`]
    return ['exit', [`"${label}" failed with exit code ${code}.`, last].filter(Boolean).join('\n')]
  }

  private tookTooLong(index: number): string {
    const seconds = this.planStep(index)?.timeoutSeconds
    return `"${this.run.steps[index].label}" took longer than ${seconds ? `${seconds} seconds` : 'allowed'} and was stopped.`
  }

  private stopBefore(index: number): void {
    this.skipFrom(index)
    this.complete('stopped', null)
  }

  private async fail(index: number, failure: RunFailure): Promise<void> {
    this.skipFrom(index + 1)
    if (this.stopRequested) return this.complete('stopped', { ...failure, message: `Stopped during "${this.run.steps[index].label}". It may have made part of its change.` })
    const notes = await this.rollBack(index, failure)
    this.complete(failure.kind === 'lost' ? 'lost' : 'failed', { ...failure, message: [failure.message, ...notes].filter(Boolean).join('\n\n') })
  }

  private skipFrom(index: number): void {
    this.run.steps.slice(index).filter((step) => step.status === 'pending').forEach((step) => { step.status = 'skipped' })
  }

  private reversibleBefore(index: number): number[] {
    return this.run.steps.slice(0, index).map((_, i) => i).filter((i) => this.run.steps[i].status === 'done' && Boolean(this.planStep(i)?.rollback)).reverse()
  }

  private async rollBack(failedIndex: number, failure: RunFailure): Promise<string[]> {
    const reversible = this.reversibleBefore(failedIndex)
    if (reversible.length === 0) return []
    if (failure.kind === 'disconnect' || failure.kind === 'lost') return ['The earlier steps were not undone because Shellway could not tell what happened. Check the server.']
    const manual = failure.kind === 'sudo' ? reversible.filter((i) => this.planStep(i)?.root) : []
    const notes: string[] = []
    for (const index of reversible.filter((i) => !manual.includes(i))) {
      const undone = await this.undo(index)
      if (undone === 'disconnected') return [...notes, 'The connection dropped while undoing the earlier steps. Check the server.']
      if (undone === 'failed') notes.push(`Could not undo "${this.run.steps[index].label}". Check the server.`)
    }
    if (manual.length > 0) notes.push(this.manualUndo(manual))
    return notes
  }

  private async undo(index: number): Promise<'done' | 'failed' | 'disconnected'> {
    const step = this.planStep(index) as ActionStep
    const state = this.run.steps[index]
    const output = this.outputFor(state)
    output.note('\n--- undo ---\n')
    let result: 'done' | 'failed' | 'disconnected' = 'failed'
    try {
      const exec = await this.exec(limitedShell(step.root, step.timeoutSeconds, KILL_AFTER_SECONDS), {
        stdin: stepInput(this.run.id, step.rollback as string, this.record.state[step.id]),
        timeoutMs: (step.timeoutSeconds + EXEC_MARGIN_SECONDS) * 1000,
        onOutput: (chunk) => output.push(chunk),
        maxOutputBytes: ATTACHED_OUTPUT_LIMIT
      })
      result = exec.code === 0 ? 'done' : 'failed'
    } catch (err) {
      result = err instanceof Disconnected ? 'disconnected' : 'failed'
    }
    output.flush()
    state.output = output.text
    if (result === 'done') state.status = 'rolled-back'
    this.deps.publish(this.record)
    return result
  }

  private manualUndo(indexes: number[]): string {
    const labels = indexes.map((i) => `"${this.run.steps[i].label}"`).join(', ')
    const scripts = indexes.map((i) => {
      const step = this.planStep(i) as ActionStep
      return stepInput(this.run.id, step.rollback as string, this.record.state[step.id])
    })
    const text = `sudo stopped working, so these steps were not undone: ${labels}. To undo them by hand, run this as root:\n\n${scripts.join('\n')}`
    return redact(text, this.secrets())
  }

  private complete(status: RunStatus, failure: RunFailure | null): void {
    Object.assign(this.run, { status, failure, finishedAt: this.deps.now() })
    this.record.detached = null
    this.deps.finish(this.record)
  }
}
