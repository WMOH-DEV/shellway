import { useState } from 'react'
import type { PlanAction, RunPhase, RunRecord } from '@/types/createSite'
import { cn } from '@/utils/cn'
import { formatSeconds } from '@/utils/deploy/siteStatus'
import { actionTitle } from '@/utils/createSite/plan'
import { PHASE_LABELS, stepPosition } from '@/utils/createSite/runView'
import { driverFor } from '@/utils/createSite/wizard'
import { useNowMs } from '../useNowMs'
import { DeployKeyCard } from './DeployKeyCard'
import { RemoveConfirm } from './RemoveConfirm'
import { RunFooter } from './RunFooter'
import { RunMessage } from './RunMessage'
import { RunOutput } from './RunOutput'
import { RunProgress } from './RunProgress'
import type { CreateRun } from './useCreateRun'

interface RunScreenProps {
  run: CreateRun & { record: RunRecord }
  plan: PlanAction[] | null
  onClose: () => void
}

const PHASE_TONE: Record<RunPhase, string> = {
  running: 'bg-nd-accent/12 text-nd-accent-hover',
  stopped: 'bg-nd-warning/12 text-nd-warning-fg',
  failed: 'bg-nd-error/12 text-nd-error-fg',
  done: 'bg-nd-success/12 text-nd-success-fg',
  removing: 'bg-nd-surface-raised text-nd-text-secondary',
  removed: 'bg-nd-surface-raised text-nd-text-secondary',
  'remove-failed': 'bg-nd-error/12 text-nd-error-fg'
}

function RunHeader({ record, nowMs }: { record: RunRecord; nowMs: number }) {
  const running = record.phase === 'running'
  return (
    <header className="flex flex-wrap items-center gap-2.5 border-b border-nd-border px-7 py-4">
      <h1 className="text-lg font-semibold text-nd-text-primary">Creating {record.domain}</h1>
      <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', PHASE_TONE[record.phase])}>{PHASE_LABELS[record.phase]}</span>
      {running && <span className="text-sm text-nd-text-muted">{stepPosition(record)}</span>}
      {running && <span className="font-mono text-xs text-nd-text-muted">{formatSeconds(Math.max(0, Math.round((nowMs - record.createdAt) / 1000)))}</span>}
    </header>
  )
}

function outputTitle(record: RunRecord, plan: PlanAction[] | null): string {
  if (record.current === null) return 'Output'
  return plan?.find((action) => action.id === record.current)?.title ?? actionTitle(record.current, driverFor(record.server))
}

export function RunScreen({ run, plan, onClose }: RunScreenProps) {
  const { record } = run
  const [confirmRemove, setConfirmRemove] = useState(false)
  const nowMs = useNowMs(record.phase === 'running')
  const live = record.phase === 'running' || record.phase === 'removing'

  const remove = () => {
    setConfirmRemove(false)
    void run.remove()
  }

  return (
    <div className="flex h-full flex-col">
      <RunHeader record={record} nowMs={nowMs} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,420px)_minmax(0,1fr)] gap-6 px-7 py-5">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <RunMessage record={record} />
          {record.deployKey && <DeployKeyCard deployKey={record.deployKey} repoUrl={record.input.repoUrl} />}
          <RunProgress record={record} plan={plan} nowMs={nowMs} />
        </div>
        <RunOutput title={outputTitle(record, plan)} output={run.output} live={live} />
      </div>
      <RunFooter run={run} onRemove={() => setConfirmRemove(true)} onClose={onClose} />
      {confirmRemove && <RemoveConfirm record={record} onConfirm={remove} onClose={() => setConfirmRemove(false)} />}
    </div>
  )
}
