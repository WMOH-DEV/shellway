import type { RunPhase, RunRecord, RunStep } from '@/types/createSite'

export type ProgressState = 'done' | 'running' | 'waiting' | 'failed' | 'skipped'

const FINISHED: ReadonlySet<RunPhase> = new Set(['done', 'removed'])

export const PHASE_LABELS: Record<RunPhase, string> = {
  running: 'Running',
  stopped: 'Stopped',
  failed: 'Failed',
  done: 'Done',
  removing: 'Removing',
  removed: 'Removed',
  'remove-failed': 'Removal failed'
}

export const isUnfinished = (record: RunRecord): boolean => !FINISHED.has(record.phase)

export const canResume = (record: RunRecord): boolean => record.phase === 'failed' || record.phase === 'stopped'

export function latestUnfinished(records: RunRecord[]): RunRecord | null {
  return records.filter(isUnfinished).reduce<RunRecord | null>((latest, record) => (latest === null || record.createdAt > latest.createdAt ? record : latest), null)
}

export function progressState(step: RunStep, record: RunRecord): ProgressState {
  if (step.status !== 'pending') return step.status
  return record.phase === 'running' && record.current === step.id ? 'running' : 'waiting'
}

export function stepSeconds(step: RunStep, nowMs: number): number | null {
  if (step.startedAt === null) return null
  return Math.max(0, Math.round(((step.finishedAt ?? nowMs) - step.startedAt) / 1000))
}

export function stepPosition(record: RunRecord): string {
  const { steps, current } = record
  const index = steps.findIndex((step) => step.id === current)
  const reached = index === -1 ? steps.filter((step) => step.status !== 'pending').length : index + 1
  return `step ${Math.max(1, reached)} of ${steps.length}`
}
