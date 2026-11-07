import { useEffect, useRef, useState } from 'react'
import type { ProbeResult } from '@/types/server/core'
import { IDENTITY_PROBE, type ServerIdentity } from '@/types/server/identity'
import { Button } from '@/components/ui/Button'
import { safeTimeZone } from '@/utils/server/jobs/cron'
import type { CronSaveParams } from '@/utils/server/jobs/cronActions'
import { CRONTABS_PROBE, JOBS_PROBES, PM2_PROBE, SUPERVISOR_PROBE, TIMERS_PROBE, USERS_PROBE, type CronEntry, type CrontabFacts, type Pm2Facts, type SupervisorFacts, type TimersFacts, type UsersFacts } from '@/utils/server/jobs/types'
import type { WorkerSaveParams } from '@/utils/server/jobs/workerActions'
import { buildWorkerRows, workerRootCauses, type WorkerRow } from '@/utils/server/jobs/workers'
import { plainCommand } from '@/utils/server/jobs/view'
import { useActionLauncher } from '../../action'
import { PageHeader, SectionPage } from '../../kit'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'
import { LogsModal, type LogsRequest } from './LogsModal'
import { newTaskDraft, TaskForm, type TaskDraft } from './TaskForm'
import { TasksCard } from './TasksCard'
import { emptyWorker, WorkerDrawer, type WorkerDraft } from './WorkerDrawer'
import { WorkersCard } from './WorkersCard'
import { useSitePaths } from './useSitePaths'

const PROBES = [...JOBS_PROBES, IDENTITY_PROBE]
const CLOCK_TICK_MS = 30_000

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

const okData = <T,>(result: ProbeResult | undefined): T | null => (result?.status === 'ok' ? (result.data as T) : null)

function workerLogs(row: WorkerRow): LogsRequest {
  const target = row.kind === 'pm2' ? { kind: 'pm2' as const, user: row.user, app: row.name } : { kind: 'supervisor' as const, process: row.firstProcess }
  return { title: `${row.label} log`, target }
}

function taskDraftOf(entry: CronEntry): TaskDraft {
  return { ref: entry.ref, id: entry.shellway?.id ?? null, user: entry.user, expression: entry.expression, command: plainCommand(entry), logOutput: entry.shellway?.logOutput ?? true }
}

export function JobsSection({ ctx }: { ctx: ServerSectionContext }) {
  const { facts, refresh } = useServerFacts(ctx, PROBES)
  const launcher = useActionLauncher(ctx)
  const connected = ctx.connectionStatus === 'connected'
  const sites = useSitePaths(ctx.connectionId, ctx.sessionId, ctx.active && connected)
  const now = useNow(ctx.active)
  const commandInput = useRef<HTMLInputElement>(null)
  const [workerDraft, setWorkerDraft] = useState<WorkerDraft | null>(null)
  const [logs, setLogs] = useState<LogsRequest | null>(null)

  const supervisor = okData<SupervisorFacts>(facts[SUPERVISOR_PROBE])
  const pm2 = okData<Pm2Facts>(facts[PM2_PROBE])
  const users = okData<UsersFacts>(facts[USERS_PROBE])
  const crontabs = okData<CrontabFacts>(facts[CRONTABS_PROBE])
  const self = users?.self ?? crontabs?.self ?? ''
  const userNames = users?.users.map((user) => user.name) ?? (self ? [self] : [])
  const timeZone = safeTimeZone(okData<ServerIdentity>(facts[IDENTITY_PROBE])?.timezone)
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(() => newTaskDraft(self))
  const [taskKey, setTaskKey] = useState(0)

  const launch = (type: string, params: unknown) => launcher.launch({ type, params, onFinished: () => void refresh() })

  const openTask = (draft: TaskDraft) => {
    setTaskDraft(draft)
    setTaskKey((key) => key + 1)
    window.setTimeout(() => commandInput.current?.focus(), 0)
  }

  const editWorker = (row: WorkerRow) => {
    const program = supervisor?.programs.find((candidate) => candidate.name === row.name)
    if (!program) return
    setWorkerDraft({ editing: true, values: { name: program.name, command: program.command.replace(/%%/g, '%'), directory: program.directory, user: program.user || 'root', numprocs: program.numprocs, autostart: program.autostart } })
  }

  const saveWorker = (values: WorkerSaveParams) => {
    setWorkerDraft(null)
    launch('jobs.worker-save', values)
  }

  const saveTask = (params: CronSaveParams) =>
    launcher.launch({
      type: 'jobs.cron-save',
      params,
      onFinished: (run) => {
        void refresh()
        if (run.status === 'done') openTask(newTaskDraft(self))
      }
    })

  const controlWorker = (row: WorkerRow, op: 'start' | 'stop' | 'restart') =>
    row.kind === 'pm2' ? launch('jobs.pm2-control', { user: row.user, name: row.name, op }) : launch('jobs.worker-control', { name: row.name, op })

  return (
    <SectionPage>
      <PageHeader
        title="Cron & workers"
        subtitle="Long-running workers kept alive by Supervisor or pm2, and scheduled tasks from crontab."
        actions={
          <>
            <Button onClick={() => openTask(newTaskDraft(self))}>Add scheduled task</Button>
            <Button variant="primary" onClick={() => setWorkerDraft(emptyWorker(self))}>Add worker</Button>
          </>
        }
      />
      <WorkersCard
        rows={buildWorkerRows(supervisor, pm2, now)}
        causes={workerRootCauses(supervisor)}
        sites={sites}
        supervisor={facts[SUPERVISOR_PROBE] as ProbeResult<SupervisorFacts> | undefined}
        pm2={facts[PM2_PROBE] as ProbeResult<Pm2Facts> | undefined}
        onControl={controlWorker}
        onLogs={(row) => setLogs(workerLogs(row))}
        onEdit={editWorker}
        onRemove={(row) => launch('jobs.worker-remove', { name: row.name })}
        onOpenServices={() => ctx.navigate({ section: 'services' })}
        onOpenSoftware={() => ctx.navigate({ section: 'software' })}
      />
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4">
        <TasksCard
          crontabs={facts[CRONTABS_PROBE] as ProbeResult<CrontabFacts> | undefined}
          timers={facts[TIMERS_PROBE] as ProbeResult<TimersFacts> | undefined}
          now={now}
          onEdit={(entry) => openTask(taskDraftOf(entry))}
          onRunNow={(entry) => launch('jobs.cron-run-now', { user: entry.user, command: plainCommand(entry) })}
          onRemove={(entry) => launch('jobs.cron-remove', { user: entry.user, ref: entry.ref })}
          onLogs={(entry) => entry.shellway && setLogs({ title: 'Task log', target: { kind: 'cron', id: entry.shellway.id } })}
        />
        <TaskForm
          key={`${taskKey}-${self}`}
          ref={commandInput}
          draft={taskDraft.user ? taskDraft : { ...taskDraft, user: self }}
          users={userNames}
          sites={sites}
          timeZone={timeZone}
          now={new Date(now)}
          onSave={saveTask}
          onRunNow={(user, command) => launch('jobs.cron-run-now', { user, command })}
          onCancel={() => openTask(newTaskDraft(self))}
        />
      </div>
      {workerDraft && <WorkerDrawer draft={workerDraft} users={userNames} sites={sites} onSave={saveWorker} onClose={() => setWorkerDraft(null)} />}
      {logs && <LogsModal connectionId={ctx.connectionId} request={logs} onClose={() => setLogs(null)} />}
    </SectionPage>
  )
}
