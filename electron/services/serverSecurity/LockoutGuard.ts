import type { ActivityEntry } from '../../../src/types/server/core'
import {
  GuardRefusal,
  PREFLIGHT_SCRIPT,
  RECHECK_SECONDS,
  REVERT_SECONDS,
  STEP_LABELS,
  armScript,
  backupScript,
  buildGuardedChange,
  cleanupScript,
  disarmScript,
  parsePreflight,
  previewOf,
  revertNowScript,
  type GuardContext,
  type GuardOutcome,
  type GuardPreview,
  type GuardRequest,
  type GuardRun,
  type GuardStep,
  type GuardStepId,
  type GuardedChange
} from '../../../src/utils/server/security/guard'
import type { RemoteExec } from '../deploy/DeployService'

export interface FreshLogin {
  run(port: number): Promise<string>
}

export interface ActivitySink {
  record(entry: ActivityEntry): void
}

export interface GuardDeps {
  exec: RemoteExec
  login: FreshLogin
  keyAuth: boolean
  configPort: number
  connectionId: string
  sessionKey: string
  onUpdate(run: GuardRun): void
  activity?: ActivitySink
  sleep?(ms: number): Promise<void>
  now?(): number
  newId(): string
}

const ROOT_SHELL = 'if [ "$(id -u)" = 0 ]; then sh -s; else sudo -n sh -s; fi'
const SHORT_MS = 20_000
const APPLY_MS = 45_000
const OUTPUT_LIMIT = 16_000
const STEP_ORDER: GuardStepId[] = ['backup', 'arm', 'apply', 'verify', 'disarm']

interface ExecOutcome {
  ok: boolean
  output: string
  stdout: string
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const clip = (text: string): string => (text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n…` : text)

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export async function readGuardContext(exec: RemoteExec): Promise<GuardContext> {
  const result = await exec('sh -s', { stdin: PREFLIGHT_SCRIPT, timeoutMs: SHORT_MS })
  return parsePreflight(result.stdout)
}

export function contextProblem(ctx: GuardContext): string {
  if (!ctx.root) return 'Firewall and SSH changes need passwordless sudo (sudo -n) on this server.'
  if (!ctx.sshPort) return 'Could not tell which port this SSH session uses.'
  return ''
}

export async function previewGuard(exec: RemoteExec, request: GuardRequest, keyAuth: boolean, configPort: number): Promise<GuardPreview> {
  const ctx = await readGuardContext(exec)
  const problem = contextProblem(ctx)
  if (problem) throw new GuardRefusal(problem)
  const change = buildGuardedChange(request, ctx, keyAuth)
  return previewOf(change, change.newPort ?? configPort)
}

export class LockoutGuard {
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private run!: GuardRun
  private armedAt = 0

  constructor(private readonly deps: GuardDeps) {
    this.sleep = deps.sleep ?? defaultSleep
    this.now = deps.now ?? Date.now
  }

  async execute(request: GuardRequest): Promise<GuardRun> {
    this.run = this.initialRun(request)
    this.publish()
    try {
      await this.guard(request)
    } catch (error) {
      this.finish(this.armedAt ? 'reverting' : 'failed', this.armedAt ? this.revertingMessage(messageOf(error)) : messageOf(error))
      if (this.armedAt) await this.recheck()
    }
    this.recordActivity()
    return this.run
  }

  private initialRun(request: GuardRequest): GuardRun {
    return {
      id: this.deps.newId(),
      connectionId: this.deps.connectionId,
      kind: request.kind,
      title: request.kind,
      startedAt: this.now(),
      finishedAt: null,
      revertAt: null,
      outcome: 'running',
      message: 'Checking the server…',
      steps: STEP_ORDER.map((id) => ({ id, label: STEP_LABELS[id], status: 'pending', detail: '', display: '', output: '' }))
    }
  }

  private async guard(request: GuardRequest): Promise<void> {
    const ctx = await readGuardContext(this.deps.exec)
    const problem = contextProblem(ctx)
    if (problem) return this.finish('failed', `${problem} Nothing was changed.`)
    let change: GuardedChange
    try {
      change = buildGuardedChange(request, ctx, this.deps.keyAuth)
    } catch (error) {
      return this.finish('failed', `${messageOf(error)} Nothing was changed.`)
    }
    this.run.title = change.title
    if (!(await this.step('backup', backupScript(this.run.id, change), SHORT_MS, 'SHELLWAY_BACKUP=ok'))) return this.abortBeforeChange('Could not back up the files. Nothing was changed.')
    if (!(await this.step('arm', armScript(this.run.id), SHORT_MS, 'SHELLWAY_ARMED='))) return this.abortBeforeChange('Could not arm the automatic undo. Nothing was changed.')
    this.armedAt = this.now()
    this.run.revertAt = this.armedAt + REVERT_SECONDS * 1000
    if (!(await this.step('apply', change.apply, APPLY_MS))) return this.undoFailedApply()
    if (!(await this.verify(ctx, change.newPort ?? this.deps.configPort))) {
      this.finish('reverting', this.revertingMessage('Could not log in with a new connection.'))
      return this.recheck()
    }
    const disarm = await this.exec(disarmScript(this.run.id), SHORT_MS)
    this.setStep('disarm', disarm.ok && disarm.stdout.includes('SHELLWAY_DISARMED=1') ? 'done' : 'failed', disarmScript(this.run.id), disarm.output)
    if (disarm.stdout.includes('SHELLWAY_REVERTED=1')) return this.finish('reverted', 'The check took too long, so the automatic undo already ran. Nothing changed. Try again.')
    if (!disarm.ok) {
      this.finish('reverting', this.revertingMessage('Could not cancel the automatic undo, so the change will be undone.'))
      return this.recheck()
    }
    this.run.revertAt = null
    this.finish('done', change.newPort ? `Done. SSH now answers on port ${change.newPort}. Change the port of this saved session to ${change.newPort}.` : 'Done. A new connection logged in fine, so the change stays.')
  }

  private async step(id: GuardStepId, script: string, timeoutMs: number, marker?: string): Promise<boolean> {
    this.setStep(id, 'running', script, '')
    const result = await this.exec(script, timeoutMs)
    const ok = result.ok && (!marker || result.stdout.includes(marker))
    this.setStep(id, ok ? 'done' : 'failed', script, result.output)
    return ok
  }

  private async exec(script: string, timeoutMs: number): Promise<ExecOutcome> {
    try {
      const result = await this.deps.exec(ROOT_SHELL, { stdin: script, timeoutMs })
      return { ok: result.code === 0, stdout: result.stdout, output: clip(`${result.stdout}${result.stderr}`.trim()) }
    } catch (error) {
      return { ok: false, stdout: '', output: messageOf(error) }
    }
  }

  private async verify(ctx: GuardContext, port: number): Promise<boolean> {
    this.setStep('verify', 'running', `new SSH connection on port ${port}`, '')
    try {
      const identity = (await this.deps.login.run(port)).trim()
      const same = !ctx.machine || identity === ctx.machine.trim()
      this.setStep('verify', same ? 'done' : 'failed', `new SSH connection on port ${port}`, same ? `Logged in on port ${port}.` : 'A server answered, but it is not this server.')
      return same
    } catch (error) {
      this.setStep('verify', 'failed', `new SSH connection on port ${port}`, messageOf(error))
      return false
    }
  }

  private async abortBeforeChange(message: string): Promise<void> {
    await this.exec(cleanupScript(this.run.id), SHORT_MS)
    this.finish('failed', message)
  }

  private async undoFailedApply(): Promise<void> {
    const undo = await this.exec(revertNowScript(this.run.id), SHORT_MS)
    if (undo.ok && undo.stdout.includes('SHELLWAY_REVERTED=1')) {
      await this.exec(cleanupScript(this.run.id), SHORT_MS)
      this.run.revertAt = null
      return this.finish('reverted', 'The change failed on the server, so it was undone right away. Nothing changed.')
    }
    this.finish('reverting', this.revertingMessage('The change failed on the server.'))
    return this.recheck()
  }

  private revertingMessage(reason: string): string {
    const seconds = Math.max(0, Math.ceil(((this.run.revertAt ?? this.now()) - this.now()) / 1000))
    return `${reason} The change will be undone automatically within ${seconds} s. Keep this window open.`
  }

  private async recheck(): Promise<void> {
    this.addRecheckStep()
    await this.sleep(Math.max(0, this.armedAt + RECHECK_SECONDS * 1000 - this.now()))
    this.setStep('recheck', 'running', `new SSH connection on port ${this.deps.configPort}`, '')
    try {
      await this.deps.login.run(this.deps.configPort)
      this.setStep('recheck', 'done', `new SSH connection on port ${this.deps.configPort}`, 'Logged in again.')
      this.finish('reverted', 'The change was undone automatically and you can log in again.')
    } catch (error) {
      this.setStep('recheck', 'failed', `new SSH connection on port ${this.deps.configPort}`, messageOf(error))
      this.finish('locked', 'Shellway still cannot open a new connection. Keep this session open and check the server from the Terminal tab before closing it.')
    }
  }

  private addRecheckStep(): void {
    if (this.run.steps.some((candidate) => candidate.id === 'recheck')) return
    this.run.steps.push({ id: 'recheck', label: STEP_LABELS.recheck, status: 'pending', detail: '', display: '', output: '' })
  }

  private setStep(id: GuardStepId, status: GuardStep['status'], display: string, output: string): void {
    this.run.steps = this.run.steps.map((step) => (step.id === id ? { ...step, status, display, output, detail: output.split('\n').pop() ?? '' } : step))
    this.publish()
  }

  private finish(outcome: GuardOutcome, message: string): void {
    this.run = { ...this.run, outcome, message, finishedAt: outcome === 'reverting' ? null : this.now() }
    this.publish()
  }

  private publish(): void {
    this.deps.onUpdate({ ...this.run, steps: this.run.steps.map((step) => ({ ...step })) })
  }

  private recordActivity(): void {
    const finishedAt = this.run.finishedAt ?? this.now()
    this.deps.activity?.record({
      id: this.run.id,
      sessionKey: this.deps.sessionKey,
      at: this.run.startedAt,
      area: 'security',
      source: 'action',
      type: `security.guard.${this.run.kind}`,
      title: this.run.title,
      who: 'you',
      durationMs: finishedAt - this.run.startedAt,
      status: this.run.outcome === 'done' ? 'done' : 'failed',
      steps: this.run.steps.filter((step) => step.status !== 'pending').map((step) => ({ label: step.label, display: step.display, output: step.output, exitCode: null, status: step.status === 'running' ? 'failed' : step.status })),
      failure: this.run.outcome === 'done' ? null : { kind: 'error', stepId: this.run.steps.find((step) => step.status === 'failed')?.id ?? null, message: this.run.message }
    })
  }
}
