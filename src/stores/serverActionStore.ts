import { create } from 'zustand'
import { settle } from '@/components/server/action/settle'
import type { LaunchRequest } from '@/components/server/action/types'
import { serverApi } from '@/components/server/serverApi'
import { toast } from '@/components/ui/Toast'
import type { ActionPlanView, ActionRun, RunOutputChunk, RunStartResult } from '@/types/server/core'

export type ActionPhase = 'planning' | 'review' | 'running' | 'finished' | 'error'

export type ReviewNotice = 'stale' | 'busy'

export interface ActionLaunch {
  id: number
  connectionId: string
  request: LaunchRequest
  phase: ActionPhase
  open: boolean
  plan?: ActionPlanView
  run?: ActionRun
  output: Record<string, string>
  notice?: ReviewNotice
  error?: string
  stopping?: boolean
}

interface ServerActionState {
  launches: Record<string, ActionLaunch>
}

export const OUTPUT_LIMIT = 200 * 1024

export const useServerActionStore = create<ServerActionState>(() => ({ launches: {} }))

let nextLaunchId = 0
let listening = false

const launchFor = (tabId: string): ActionLaunch | undefined => useServerActionStore.getState().launches[tabId]

const phaseOf = (run: ActionRun): ActionPhase => (run.status === 'running' ? 'running' : 'finished')

export const isLaunchBusy = (launch: ActionLaunch | undefined): boolean => launch?.phase === 'planning' || launch?.phase === 'running'

export function appendCapped(previous: string, chunk: string, limit = OUTPUT_LIMIT): string {
  const next = previous + chunk
  return next.length > limit ? next.slice(next.length - limit) : next
}

function patch(tabId: string, launchId: number, changes: Partial<ActionLaunch>): void {
  useServerActionStore.setState((state) => {
    const current = state.launches[tabId]
    if (current?.id !== launchId) return state
    return { launches: { ...state.launches, [tabId]: { ...current, ...changes } } }
  })
}

function removeLaunch(tabId: string): void {
  useServerActionStore.setState((state) => {
    const { [tabId]: _removed, ...rest } = state.launches
    return { launches: rest }
  })
}

function findTab(matches: (launch: ActionLaunch) => boolean): string | undefined {
  const { launches } = useServerActionStore.getState()
  return Object.keys(launches).find((tabId) => matches(launches[tabId]))
}

function ownsRun(launch: ActionLaunch, run: ActionRun): boolean {
  if (launch.run) return launch.run.id === run.id
  return launch.phase === 'running' && launch.plan?.planId === run.planId
}

function applyRunUpdate(run: ActionRun): void {
  const tabId = findTab((launch) => ownsRun(launch, run))
  if (!tabId) return
  patch(tabId, launchFor(tabId)!.id, { run, phase: phaseOf(run) })
}

function applyOutput({ runId, stepId, chunk }: RunOutputChunk): void {
  const tabId = findTab((launch) => launch.run?.id === runId)
  if (!tabId) return
  const launch = launchFor(tabId)!
  patch(tabId, launch.id, { output: { ...launch.output, [stepId]: appendCapped(launch.output[stepId] ?? '', chunk) } })
}

export function listenForRuns(): void {
  if (listening) return
  listening = true
  serverApi().onRun(applyRunUpdate)
  serverApi().onOutput(applyOutput)
}

async function loadPlan(tabId: string, launch: ActionLaunch): Promise<void> {
  const result = await settle(serverApi().plan(launch.connectionId, launch.request.type, launch.request.params))
  if (!result.success) return patch(tabId, launch.id, { phase: 'error', error: result.error })
  patch(tabId, launch.id, { phase: 'review', plan: result.data })
}

function openLaunch(tabId: string, connectionId: string, request: LaunchRequest): void {
  const launch: ActionLaunch = { id: ++nextLaunchId, connectionId, request, phase: 'planning', open: true, output: {} }
  useServerActionStore.setState((state) => ({ launches: { ...state.launches, [tabId]: launch } }))
  void loadPlan(tabId, launch)
}

export function launchAction(tabId: string, connectionId: string, request: LaunchRequest): void {
  listenForRuns()
  if (isLaunchBusy(launchFor(tabId))) {
    toast.warning('An action is already running', 'Wait for it to finish, then try again.')
    return
  }
  openLaunch(tabId, connectionId, request)
}

export function reviewAgain(tabId: string): void {
  const launch = launchFor(tabId)
  if (!launch || isLaunchBusy(launch)) return
  openLaunch(tabId, launch.connectionId, launch.request)
}

function applyStart(tabId: string, launchId: number, start: RunStartResult): void {
  if (start.kind === 'stale') return patch(tabId, launchId, { phase: 'review', plan: start.plan, notice: 'stale' })
  if (start.kind === 'busy') return patch(tabId, launchId, { phase: 'review', notice: 'busy' })
  const known = launchFor(tabId)?.run
  const run = known?.id === start.run.id ? known : start.run
  patch(tabId, launchId, { run, phase: phaseOf(run) })
}

export async function runAction(tabId: string, sessionKey: string): Promise<void> {
  const launch = launchFor(tabId)
  if (launch?.phase !== 'review' || !launch.plan || launch.plan.blocked) return
  patch(tabId, launch.id, { phase: 'running', notice: undefined, run: undefined, output: {} })
  const result = await settle(serverApi().run(launch.connectionId, sessionKey, launch.plan.planId))
  if (!result.success) return patch(tabId, launch.id, { phase: 'error', error: result.error })
  applyStart(tabId, launch.id, result.data)
}

export async function stopAction(tabId: string): Promise<void> {
  const launch = launchFor(tabId)
  if (!launch?.run || launch.phase !== 'running') return
  patch(tabId, launch.id, { stopping: true })
  const result = await settle(serverApi().stop(launch.run.id))
  if (result.success) return
  patch(tabId, launch.id, { stopping: false })
  toast.error('Could not stop the action', result.error)
}

export function setDrawerOpen(tabId: string, open: boolean): void {
  const launch = launchFor(tabId)
  if (launch) patch(tabId, launch.id, { open })
}

export function closeLaunch(tabId: string): void {
  const launch = launchFor(tabId)
  if (!launch) return
  if (launch.phase === 'running') return setDrawerOpen(tabId, false)
  removeLaunch(tabId)
  if (launch.run?.status === 'done') launch.request.onFinished?.(launch.run)
}
