import type { ActionRun, RunFailureKind, RunStepState, RunStepStatus } from '@/types/server/core'
import { formatSeconds } from '@/utils/deploy/siteStatus'
import { pluralize } from '@/utils/ssl/time'

const FAILURE_HEADLINES: Record<RunFailureKind, string> = {
  sudo: 'This step needs passwordless sudo, and sudo asked for a password.',
  exit: 'A command in this step failed.',
  timeout: 'This step took too long and was stopped.',
  disconnect: 'The connection to the server dropped during this step.',
  changed: 'The file changed on the server since you reviewed; review again.',
  lost: 'Shellway lost track of this action. Check the server before running it again.',
  error: 'Something went wrong while running this step.'
}

export const STEP_STATUS_TEXT: Record<RunStepStatus, string> = {
  pending: 'Waiting',
  running: 'Running…',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  'rolled-back': 'Rolled back'
}

export function elapsedSeconds(startedAt: number, finishedAt: number | null, nowMs: number): number {
  return Math.max(0, Math.round(((finishedAt ?? nowMs) - startedAt) / 1000))
}

export function failureHeadline(run: ActionRun): string {
  if (run.status === 'stopped') return 'Stopped. The finished steps stay as they are.'
  if (run.status === 'lost') return FAILURE_HEADLINES.lost
  return FAILURE_HEADLINES[run.failure?.kind ?? 'error']
}

export function failureDetail(run: ActionRun): string | null {
  const message = run.failure?.message.trim()
  return message && message !== failureHeadline(run) ? message : null
}

export function successSentence(run: ActionRun): string {
  const seconds = elapsedSeconds(run.startedAt, run.finishedAt, run.startedAt)
  return `Done. ${pluralize(run.steps.length, 'step')} finished in ${formatSeconds(seconds)}.`
}

export function failedStep(run: ActionRun): RunStepState | undefined {
  const stepId = run.failure?.stepId
  return run.steps.find((step) => step.id === stepId) ?? run.steps.find((step) => step.status === 'failed')
}

export function rolledBackLabels(run: ActionRun): string[] {
  return run.steps.filter((step) => step.status === 'rolled-back').map((step) => step.label)
}

export function stepOutput(step: RunStepState, streamed: Record<string, string>): string {
  return streamed[step.id] || step.output
}

export function focusStep(steps: RunStepState[]): RunStepState | undefined {
  return steps.find((step) => step.status === 'running') ?? [...steps].reverse().find((step) => step.status !== 'pending')
}
