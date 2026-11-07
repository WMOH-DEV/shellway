import type { ActionRun, ActivityEntry, ActivityStep, RunStatus, RunStepStatus } from '../../../src/types/server/core'
import type { RunRecord, RunPhase } from '../../../src/types/createSite'
import type { DeployRecord, DeployStatus } from '../../../src/types/deploy'

export const MAX_ACTIVITY_OUTPUT = 16 * 1024

const tail = (text: string): string => text.slice(-MAX_ACTIVITY_OUTPUT)

export function entryFromRun(run: ActionRun): ActivityEntry {
  return {
    id: `action:${run.id}`,
    sessionKey: run.sessionKey,
    at: run.startedAt,
    area: run.area,
    source: 'action',
    type: run.type,
    title: run.title,
    who: 'you',
    durationMs: Math.max(0, (run.finishedAt ?? run.startedAt) - run.startedAt),
    status: run.status,
    steps: run.steps.map((step): ActivityStep => ({ label: step.label, display: step.display, output: tail(step.output), exitCode: step.exitCode, status: step.status })),
    failure: run.failure,
    undo: run.undo
  }
}

const DEPLOY_STATUS: Partial<Record<DeployStatus, RunStatus>> = {
  success: 'done',
  warning: 'done',
  failed: 'failed',
  reverted: 'failed',
  cancelled: 'stopped'
}

const DEPLOY_STEP_STATUS: Record<RunStatus, RunStepStatus> = { done: 'done', failed: 'failed', stopped: 'skipped', running: 'running', lost: 'failed' }

export function entryFromDeploy(sessionKey: string, site: string, record: DeployRecord): ActivityEntry | null {
  const status = DEPLOY_STATUS[record.status]
  if (!status) return null
  const started = record.started * 1000
  const title = record.trigger === 'rollback' ? `Roll back ${site}` : `Deploy ${site}`
  return {
    id: `deploy:${site}:${record.id}`,
    sessionKey,
    at: started,
    area: 'sites',
    source: 'deploy',
    type: `deploy.${record.trigger || 'manual'}`,
    title,
    who: record.trigger === 'auto' ? 'auto' : 'you',
    durationMs: record.finished ? Math.max(0, record.finished * 1000 - started) : 0,
    status,
    steps: [{ label: title, display: `shellway-deploy ${record.trigger === 'rollback' ? 'rollback' : 'deploy'} ${site}`, output: record.note, exitCode: null, status: DEPLOY_STEP_STATUS[status] }],
    failure: status === 'failed' ? { kind: 'exit', stepId: null, message: record.note || `The deploy of ${site} failed.` } : null
  }
}

const CREATE_SITE_STATUS: Partial<Record<RunPhase, RunStatus>> = {
  done: 'done',
  removed: 'done',
  failed: 'failed',
  'remove-failed': 'failed',
  stopped: 'stopped'
}

const humanize = (id: string): string => {
  const words = id.replace(/[-_]/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function entryFromCreateSite(record: RunRecord, now: number): ActivityEntry | null {
  const status = CREATE_SITE_STATUS[record.phase]
  if (!status) return null
  const removal = record.phase === 'removed' || record.phase === 'remove-failed'
  return {
    id: `create-site:${record.id}:${record.phase}`,
    sessionKey: record.sessionId,
    at: record.createdAt,
    area: 'sites',
    source: 'create-site',
    type: removal ? 'create-site.remove' : 'create-site',
    title: removal ? `Remove site ${record.domain}` : `Create site ${record.domain}`,
    who: 'you',
    durationMs: Math.max(0, now - record.createdAt),
    status,
    steps: record.steps.map((step): ActivityStep => ({ label: humanize(step.id), display: '', output: '', exitCode: null, status: step.status })),
    failure: record.error ? { kind: 'exit', stepId: record.current, message: record.error } : null
  }
}
