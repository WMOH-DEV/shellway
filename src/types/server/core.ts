export type ServerArea =
  | 'core'
  | 'overview'
  | 'sites'
  | 'software'
  | 'services'
  | 'docker'
  | 'databases'
  | 'jobs'
  | 'security'
  | 'activity'
  | 'settings'
  | 'setup'

export type ServerSection = Exclude<ServerArea, 'core'>

export interface ServerRoute {
  section: ServerSection
  sub?: string
  params?: Record<string, string>
}

export type ProbeResult<T = unknown> =
  | { status: 'ok'; data: T; at: number }
  | { status: 'unavailable'; reason: string; at: number }
  | { status: 'error'; error: string; at: number }

export type ServerFacts = Record<string, ProbeResult>

export interface ProbeDefinition<T = unknown> {
  id: string
  area: ServerArea
  root: boolean
  timeoutSeconds: number
  script: string
  parse(stdout: string): T
}

export type AttentionLevel = 'error' | 'warning' | 'info'

export interface AttentionItem {
  id: string
  area: ServerSection
  level: AttentionLevel
  rank: number
  title: string
  detail: string
  actionLabel: string
  route: ServerRoute
}

export type PlanBlockKind = 'sudo' | 'unsupported' | 'precondition'

export interface PlanBlock {
  kind: PlanBlockKind
  message: string
}

export type ActionStepKind = 'command' | 'file-edit'

export interface ActionStep {
  id: string
  label: string
  kind: ActionStepKind
  root: boolean
  script: string
  display: string
  diff?: string
  timeoutSeconds: number
  detached?: boolean
  rollback?: string
  cleanExits?: number[]
  unreadableFile?: string
}

export interface UndoRef {
  type: string
  params: unknown
}

export interface ActionPlan {
  title: string
  area: ServerArea
  summary: string
  steps: ActionStep[]
  warnings: string[]
  blocked: PlanBlock | null
  secrets: string[]
  undo?: UndoRef
}

export interface ActionDefinition<P = unknown> {
  type: string
  area: ServerArea
  needs: string[]
  validate(raw: unknown): P
  plan(params: P, facts: ServerFacts): ActionPlan
}

export interface PlanStepView {
  id: string
  label: string
  kind: ActionStepKind
  root: boolean
  display: string
  diff?: string
  detached: boolean
  reversible: boolean
}

export interface ActionPlanView {
  planId: string
  type: string
  title: string
  area: ServerArea
  summary: string
  steps: PlanStepView[]
  warnings: string[]
  blocked: PlanBlock | null
  expiresAt: number
}

export type RunStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'rolled-back'

export interface RunStepState {
  id: string
  label: string
  display: string
  status: RunStepStatus
  startedAt: number | null
  finishedAt: number | null
  exitCode: number | null
  output: string
}

export type RunStatus = 'running' | 'done' | 'failed' | 'stopped' | 'lost'

export type RunFailureKind = 'sudo' | 'exit' | 'timeout' | 'disconnect' | 'changed' | 'lost' | 'error'

export interface RunFailure {
  kind: RunFailureKind
  stepId: string | null
  message: string
}

export interface ActionRun {
  id: string
  planId: string
  connectionId: string
  sessionKey: string
  type: string
  area: ServerArea
  title: string
  status: RunStatus
  startedAt: number
  finishedAt: number | null
  steps: RunStepState[]
  failure: RunFailure | null
  undo?: UndoRef
}

export type RunStartResult =
  | { kind: 'started'; run: ActionRun }
  | { kind: 'stale'; plan: ActionPlanView }
  | { kind: 'busy'; runId: string }

export interface RunOutputChunk {
  runId: string
  stepId: string
  chunk: string
}

export type ActivityWho = 'you' | 'auto' | 'scheduled' | 'detected'

export type ActivitySource = 'action' | 'deploy' | 'create-site' | 'ssl'

export interface ActivityStep {
  label: string
  display: string
  output: string
  exitCode: number | null
  status: RunStepStatus
}

export interface ActivityEntry {
  id: string
  sessionKey: string
  at: number
  area: ServerArea
  source: ActivitySource
  type: string
  title: string
  who: ActivityWho
  durationMs: number
  status: RunStatus
  steps: ActivityStep[]
  failure: RunFailure | null
  undo?: UndoRef
}

export interface ActivityQuery {
  area?: ServerArea
  status?: RunStatus
  text?: string
  limit?: number
  before?: number
}

export interface AreaModule {
  id: ServerArea
  probes: ProbeDefinition[]
  actions: ActionDefinition[]
  attention(facts: ServerFacts): AttentionItem[]
}

export type ServerResult<T = void> = { success: true; data: T } | { success: false; error: string }
