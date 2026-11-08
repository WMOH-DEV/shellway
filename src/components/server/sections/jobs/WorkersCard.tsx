import { Pencil, Trash2 } from 'lucide-react'
import type { ProbeResult } from '@/types/server/core'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/utils/cn'
import type { Pm2Facts, SupervisorFacts } from '@/utils/server/jobs/types'
import { rootCauseSentence, type RootCause, type WorkerHealth, type WorkerRow } from '@/utils/server/jobs/workers'
import { siteFor, type SitePath } from '@/utils/server/jobs/view'
import { Chip, Notice, SectionCard, StatusDot, TEXT_TONE, type KitTone } from '../../kit'

export interface WorkerHandlers {
  onControl(row: WorkerRow, op: 'start' | 'stop' | 'restart'): void
  onLogs(row: WorkerRow): void
  onEdit(row: WorkerRow): void
  onRemove(row: WorkerRow): void
  onOpenServices(): void
  onOpenSoftware(): void
}

interface WorkersCardProps extends WorkerHandlers {
  rows: WorkerRow[]
  causes: RootCause[]
  sites: SitePath[]
  supervisor: ProbeResult<SupervisorFacts> | undefined
  pm2: ProbeResult<Pm2Facts> | undefined
}

const HEALTH_TONE: Record<WorkerHealth, KitTone> = { running: 'success', starting: 'info', stopped: 'neutral', failing: 'error' }

function subline(row: WorkerRow, sites: SitePath[]): string {
  const where = siteFor(row.directory, sites)?.name ?? (row.directory || `as ${row.user}`)
  const count = row.processes > 1 ? ` · ${row.processes} ${row.kind === 'pm2' ? 'instances' : 'processes'}` : ''
  return `${where}${count}`
}

function IconAction({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
      {children}
    </button>
  )
}

function WorkerLine({ row, sites, handlers }: { row: WorkerRow; sites: SitePath[]; handlers: WorkerHandlers }) {
  const tone = HEALTH_TONE[row.health]
  const stopped = row.health === 'stopped'
  return (
    <div className={cn('grid grid-cols-[8px_minmax(0,1fr)_minmax(0,1.3fr)_90px_150px_auto] items-center gap-3.5 border-b border-nd-border px-4 py-[11px] last:border-b-0', row.health === 'failing' && 'bg-nd-error/[0.05]')}>
      <StatusDot tone={tone} label={row.health} />
      <span className="flex min-w-0 flex-col gap-px">
        <span className="truncate font-medium text-nd-text-primary" title={row.name}>{row.label}</span>
        <span className="truncate text-xs text-nd-text-muted">{subline(row, sites)}</span>
      </span>
      <span className="truncate font-mono text-xs text-nd-text-muted" title={row.command}>{row.command || '—'}</span>
      <span><Chip dense>{row.kind}</Chip></span>
      <span className={cn('text-[12.5px]', row.health === 'failing' ? TEXT_TONE.error : 'text-nd-text-secondary')}>{row.detail}</span>
      <span className="flex items-center justify-end gap-1">
        <Button size="sm" onClick={() => handlers.onControl(row, stopped ? 'start' : 'restart')}>{stopped ? 'Start' : 'Restart'}</Button>
        {!stopped && <Button size="sm" variant="ghost" onClick={() => handlers.onControl(row, 'stop')}>Stop</Button>}
        <Button size="sm" onClick={() => handlers.onLogs(row)}>Logs</Button>
        {row.editable && (
          <>
            <IconAction label={`Edit ${row.label}`} onClick={() => handlers.onEdit(row)}><Pencil size={14} /></IconAction>
            <IconAction label={`Remove ${row.label}`} onClick={() => handlers.onRemove(row)}><Trash2 size={14} /></IconAction>
          </>
        )}
      </span>
    </div>
  )
}

function RootCauseBanner({ cause, onOpenServices }: { cause: RootCause; onOpenServices(): void }) {
  return (
    <div role="alert" className="flex items-center gap-2.5 border-t border-nd-border bg-nd-error/[0.06] px-4 py-2.5 text-[13px] text-nd-text-secondary">
      <StatusDot tone="error" />
      <span>{rootCauseSentence(cause)}</span>
      <div className="flex-1" />
      <Button size="sm" variant="primary" onClick={onOpenServices}>Fix {cause.label}</Button>
    </div>
  )
}

function SourceNotices({ supervisor, pm2, onOpenSoftware }: Pick<WorkersCardProps, 'supervisor' | 'pm2' | 'onOpenSoftware'>) {
  const notices: React.ReactNode[] = []
  if (supervisor?.status === 'unavailable') notices.push(<Notice key="sup" tone="neutral" title="Supervisor workers are unavailable">{supervisor.reason}</Notice>)
  if (supervisor?.status === 'error') notices.push(<Notice key="sup" tone="error" title="Could not read Supervisor">{supervisor.error}</Notice>)
  if (supervisor?.status === 'ok' && !supervisor.data.installed) {
    notices.push(<Notice key="sup" tone="neutral" title="Supervisor is not installed" action={<Button size="sm" onClick={onOpenSoftware}>Open Software</Button>}>Install it to keep queue workers running.</Notice>)
  }
  if (supervisor?.status === 'ok' && supervisor.data.installed && !supervisor.data.running) notices.push(<Notice key="sup" tone="warning" title="Supervisor is not running">Start the supervisor service in Services.</Notice>)
  if (pm2?.status === 'error') notices.push(<Notice key="pm2" tone="error" title="Could not read pm2">{pm2.error}</Notice>)
  return notices.length ? <div className="flex flex-col gap-2 p-3">{notices}</div> : null
}

export function WorkersCard(props: WorkersCardProps) {
  const { rows, causes, sites, supervisor, pm2 } = props
  const checking = !supervisor && !pm2
  return (
    <SectionCard title="Workers" count={rows.length} flush>
      {checking && (
        <div className="flex items-center justify-center gap-2 px-4 py-6 text-[13px] text-nd-text-muted">
          <Spinner size="sm" />
          Checking workers…
        </div>
      )}
      {!checking && rows.length === 0 && <p className="px-4 py-5 text-[13px] text-nd-text-muted">No workers yet. Add one to keep a queue or app running.</p>}
      {rows.map((row) => <WorkerLine key={row.key} row={row} sites={sites} handlers={props} />)}
      {causes.map((cause) => <RootCauseBanner key={cause.service} cause={cause} onOpenServices={props.onOpenServices} />)}
      <SourceNotices supervisor={supervisor} pm2={pm2} onOpenSoftware={props.onOpenSoftware} />
    </SectionCard>
  )
}
