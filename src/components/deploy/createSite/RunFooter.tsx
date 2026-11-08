import { ExternalLink, RotateCcw, SkipForward, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { RunRecord } from '@/types/createSite'
import { canDelete, canResume } from '@/utils/createSite/runView'
import type { CreateRun } from './useCreateRun'

interface RunFooterProps {
  run: CreateRun & { record: RunRecord }
  onRemove: () => void
  onDelete: () => void
  onClose: () => void
}

const openSite = (domain: string) => window.open(`https://${domain}`, '_blank', 'noopener,noreferrer')

function RunningActions({ run }: Pick<RunFooterProps, 'run'>) {
  return (
    <>
      <span className="text-xs text-nd-text-muted">Keep Shellway open until it finishes. Each step runs once.</span>
      <Button onClick={() => void run.stop()} disabled={run.busy || run.stopRequested}>
        {run.stopRequested ? 'Stopping after this step…' : 'Stop after this step'}
      </Button>
      <Button variant="primary" disabled><ExternalLink size={13} /> Open site</Button>
    </>
  )
}

function ResumeActions({ run, onRemove }: Pick<RunFooterProps, 'run' | 'onRemove'>) {
  return (
    <>
      <Button variant="ghost" onClick={onRemove} disabled={run.busy}><Trash2 size={13} /> Remove what this wizard created</Button>
      <Button onClick={() => void run.resume('continue')} disabled={run.busy}><SkipForward size={13} /> Continue from here</Button>
      <Button variant="primary" onClick={() => void run.resume('retry')} disabled={run.busy}><RotateCcw size={13} /> Retry this step</Button>
    </>
  )
}

function DoneActions({ run, onDelete }: Pick<RunFooterProps, 'run' | 'onDelete'>) {
  return (
    <>
      {canDelete(run.record) && <Button variant="ghost" onClick={onDelete} disabled={run.busy}><Trash2 size={13} /> Delete site</Button>}
      <Button variant="primary" onClick={() => openSite(run.record.domain)}><ExternalLink size={13} /> Open site</Button>
    </>
  )
}

function PhaseActions({ run, onRemove, onDelete }: Pick<RunFooterProps, 'run' | 'onRemove' | 'onDelete'>) {
  const { phase, deleting } = run.record
  if (phase === 'running') return <RunningActions run={run} />
  if (canResume(run.record)) return <ResumeActions run={run} onRemove={onRemove} />
  if (phase === 'done') return <DoneActions run={run} onDelete={onDelete} />
  if (phase === 'remove-failed' && deleting) return <Button variant="primary" onClick={onDelete} disabled={run.busy}><Trash2 size={13} /> Try deleting again</Button>
  if (phase === 'remove-failed') return <Button variant="primary" onClick={onRemove} disabled={run.busy}><Trash2 size={13} /> Try removing again</Button>
  return null
}

export function RunFooter({ run, onRemove, onDelete, onClose }: RunFooterProps) {
  return (
    <footer className="flex flex-wrap items-center gap-2.5 border-t border-nd-border bg-nd-bg-secondary px-7 py-3">
      <Button onClick={onClose}>Back to sites</Button>
      <div className="flex-1" />
      {run.error && <span role="alert" className="max-w-[40%] truncate text-xs text-nd-error-fg" title={run.error}>{run.error}</span>}
      <PhaseActions run={run} onRemove={onRemove} onDelete={onDelete} />
    </footer>
  )
}
