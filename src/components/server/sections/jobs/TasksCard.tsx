import { FileText, Pencil, Play, Trash2 } from 'lucide-react'
import type { ProbeResult } from '@/types/server/core'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/utils/cn'
import { describeCron } from '@/utils/server/jobs/cron'
import type { CronEntry, CrontabFacts, TimersFacts } from '@/utils/server/jobs/types'
import { lastResult, userTasks } from '@/utils/server/jobs/view'
import { Chip, Label, Notice, SectionCard, TEXT_TONE } from '../../kit'

export interface TaskHandlers {
  onEdit(entry: CronEntry): void
  onRunNow(entry: CronEntry): void
  onRemove(entry: CronEntry): void
  onLogs(entry: CronEntry): void
}

interface TasksCardProps extends TaskHandlers {
  crontabs: ProbeResult<CrontabFacts> | undefined
  timers: ProbeResult<TimersFacts> | undefined
  now: number
}

function IconAction({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
      {children}
    </button>
  )
}

function TaskLine({ entry, now, handlers }: { entry: CronEntry; now: number; handlers?: TaskHandlers }) {
  const result = lastResult(entry, now)
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)_70px_120px_96px] items-center gap-3.5 border-b border-nd-border px-4 py-2.5 last:border-b-0">
      <span className="flex min-w-0 flex-col gap-px">
        <span className="truncate text-nd-text-primary">{describeCron(entry.expression)}</span>
        <span className="truncate font-mono text-xs text-nd-text-muted">{entry.expression}</span>
      </span>
      <span className="truncate font-mono text-xs text-nd-text-secondary" title={entry.command}>{entry.command}</span>
      <span className="truncate text-xs text-nd-text-muted">{entry.user}</span>
      <span className={cn('truncate text-xs', TEXT_TONE[result.tone])}>{result.text}</span>
      <span className="flex justify-end gap-0.5">
        {handlers ? (
          <>
            {entry.shellway && <IconAction label="Show log" onClick={() => handlers.onLogs(entry)}><FileText size={14} /></IconAction>}
            <IconAction label="Run once now" onClick={() => handlers.onRunNow(entry)}><Play size={14} /></IconAction>
            <IconAction label="Edit" onClick={() => handlers.onEdit(entry)}><Pencil size={14} /></IconAction>
            <IconAction label="Remove" onClick={() => handlers.onRemove(entry)}><Trash2 size={14} /></IconAction>
          </>
        ) : (
          <Chip dense mono>{entry.source.replace('/etc/', '')}</Chip>
        )}
      </span>
    </div>
  )
}

function TimersList({ timers }: { timers: TimersFacts }) {
  if (!timers.available || timers.timers.length === 0) return null
  return (
    <div className="flex flex-col border-t border-nd-border">
      <div className="flex items-center gap-2 px-4 pb-1.5 pt-3">
        <Label>Timers</Label>
        <span className="text-xs text-nd-text-muted">systemd, read-only</span>
      </div>
      {timers.timers.map((timer) => (
        <div key={timer.unit} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3.5 px-4 py-2 text-xs">
          <span className="flex min-w-0 flex-col gap-px">
            <span className="truncate font-mono text-nd-text-secondary">{timer.unit}</span>
            <span className="truncate text-nd-text-muted">{timer.description}</span>
          </span>
          <span className="truncate text-nd-text-muted">Next: {timer.next || '—'}</span>
          <span className="truncate text-nd-text-muted">Last: {timer.last || 'never'}</span>
        </div>
      ))}
    </div>
  )
}

function subtitle(facts: CrontabFacts): string {
  const users = facts.crontabs.map((crontab) => crontab.user)
  return users.length ? `crontab of ${users.join(' and ')}` : ''
}

export function TasksCard({ crontabs, timers, now, ...handlers }: TasksCardProps) {
  const facts = crontabs?.status === 'ok' ? crontabs.data : null
  const tasks = userTasks(facts)
  return (
    <SectionCard title="Scheduled tasks" count={facts ? subtitle(facts) : undefined} flush>
      {!crontabs && (
        <div className="flex items-center justify-center gap-2 px-4 py-6 text-[13px] text-nd-text-muted">
          <Spinner size="sm" />
          Reading crontabs…
        </div>
      )}
      {crontabs?.status === 'unavailable' && <div className="p-3"><Notice tone="neutral" title="Scheduled tasks are unavailable">{crontabs.reason}</Notice></div>}
      {crontabs?.status === 'error' && <div className="p-3"><Notice tone="error" title="Could not read crontabs">{crontabs.error}</Notice></div>}
      {facts && !facts.installed && <div className="p-3"><Notice tone="neutral" title="cron is not installed">Install the cron package to schedule tasks.</Notice></div>}
      {facts?.installed && tasks.length === 0 && <p className="px-4 py-5 text-[13px] text-nd-text-muted">No scheduled tasks yet.</p>}
      {tasks.map((entry) => <TaskLine key={`${entry.user}:${entry.ref}`} entry={entry} now={now} handlers={handlers} />)}
      {facts?.installed && !facts.readsOthers && (
        <div className="p-3"><Notice tone="neutral">Only the crontab of {facts.self} is shown. Shellway needs passwordless sudo to read root and other users.</Notice></div>
      )}
      {facts && facts.system.length > 0 && (
        <div className="flex flex-col border-t border-nd-border">
          <div className="flex items-center gap-2 px-4 pb-1.5 pt-3">
            <Label>System</Label>
            <span className="text-xs text-nd-text-muted">/etc/crontab and /etc/cron.d, read-only</span>
          </div>
          {facts.system.map((entry) => <TaskLine key={entry.ref} entry={entry} now={now} />)}
        </div>
      )}
      {timers?.status === 'ok' && <TimersList timers={timers.data} />}
    </SectionCard>
  )
}
