import type { AttentionItem, ServerFacts } from '@/types/server/core'
import { describeCron } from './cron'
import { factData } from './plan'
import { CRONTABS_PROBE, PM2_PROBE, SUPERVISOR_PROBE, type CronEntry, type CrontabFacts, type Pm2Facts, type SupervisorFacts } from './types'
import { buildWorkerRows, workerRootCauses, type WorkerRow } from './workers'

export const WORKER_FAILING_RANK = 145
export const TASK_FAILED_RANK = 70

const JOBS_ROUTE = { section: 'jobs' as const }

function workerItem(row: WorkerRow, causes: Map<string, string>): AttentionItem {
  return {
    id: `jobs.worker.${row.key}`,
    area: 'jobs',
    level: 'error',
    rank: WORKER_FAILING_RANK,
    title: `${row.label} keeps failing`,
    detail: causes.get(row.key) ?? row.detail,
    actionLabel: 'Open workers',
    route: JOBS_ROUTE
  }
}

function taskItem(entry: CronEntry): AttentionItem {
  return {
    id: `jobs.task.${entry.user}.${entry.ref}`,
    area: 'jobs',
    level: 'warning',
    rank: TASK_FAILED_RANK,
    title: 'Scheduled task failed',
    detail: `${describeCron(entry.expression)} as ${entry.user}, exit code ${entry.lastRun?.exitCode}`,
    actionLabel: 'Open scheduled tasks',
    route: JOBS_ROUTE
  }
}

export function jobsAttention(facts: ServerFacts): AttentionItem[] {
  const supervisor = factData<SupervisorFacts>(facts, SUPERVISOR_PROBE)
  const causes = new Map(workerRootCauses(supervisor).flatMap((cause) => cause.programs.map((program): [string, string] => [`supervisor:${program}`, `${cause.label} is not running`])))
  const failing = buildWorkerRows(supervisor, factData<Pm2Facts>(facts, PM2_PROBE), Date.now()).filter((row) => row.health === 'failing')
  const failedTasks = (factData<CrontabFacts>(facts, CRONTABS_PROBE)?.crontabs ?? []).flatMap((crontab) => crontab.entries).filter((entry) => entry.lastRun && entry.lastRun.exitCode !== 0)
  return [...failing.map((row) => workerItem(row, causes)), ...failedTasks.map(taskItem)]
}
