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

const DELETE_LABELS: Partial<Record<RunPhase, string>> = {
  removing: 'Deleting',
  removed: 'Deleted',
  'remove-failed': 'Delete failed'
}

export const phaseLabel = (record: RunRecord): string => (record.deleting ? DELETE_LABELS[record.phase] : undefined) ?? PHASE_LABELS[record.phase]

export const NO_MACHINE_ID = 'This site was made before Shellway recorded which server it is on, so it cannot be deleted from here. Remove it in the Deploy and SSL tabs instead.'

export const UNREADABLE_MACHINE_ID = 'Shellway could not read the machine ID of this server when it made the site, so it cannot check that it would delete on the same server. Remove it in the Deploy and SSL tabs instead.'

export const isFinishedSite = (record: RunRecord): boolean => record.phase === 'done' || (record.phase === 'remove-failed' && record.deleting === true)

export function deleteBlockedReason({ machineId }: RunRecord): string | null {
  if (machineId === undefined) return NO_MACHINE_ID
  return machineId === null ? UNREADABLE_MACHINE_ID : null
}

export const canDelete = (record: RunRecord): boolean => isFinishedSite(record) && deleteBlockedReason(record) === null

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
