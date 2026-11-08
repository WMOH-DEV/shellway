import { useEffect, useState } from 'react'
import { Check, Circle, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/utils/cn'
import { REVERT_SECONDS, type GuardOutcome, type GuardRun, type GuardStep } from '@/utils/server/security/guard'
import { CodeBox, Notice, type KitTone } from '../../kit'
import type { GuardController } from './useGuard'

const OUTCOME_TONE: Record<GuardOutcome, KitTone> = {
  running: 'info',
  done: 'success',
  reverting: 'warning',
  reverted: 'warning',
  failed: 'error',
  locked: 'error'
}

const OUTCOME_TITLE: Record<GuardOutcome, string> = {
  running: 'Working…',
  done: 'Done',
  reverting: 'Undoing the change',
  reverted: 'The change was undone',
  failed: 'Not changed',
  locked: 'Still cannot log in'
}

function useSecondsLeft(until: number | null): number | null {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (until === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [until])
  return until === null ? null : Math.max(0, Math.ceil((until - now) / 1000))
}

function StepIcon({ status }: { status: GuardStep['status'] }) {
  if (status === 'running') return <Spinner size="sm" />
  if (status === 'done') return <Check size={14} className="text-nd-success-fg" aria-hidden />
  if (status === 'failed') return <X size={14} className="text-nd-error-fg" aria-hidden />
  return <Circle size={10} className="text-nd-text-faint" aria-hidden />
}

function StepList({ steps }: { steps: GuardStep[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2.5 rounded-[10px] border border-nd-border bg-nd-surface px-3 py-2">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
            <StepIcon status={step.status} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className={cn('text-[13px]', step.status === 'pending' ? 'text-nd-text-muted' : 'text-nd-text-primary')}>{step.label}</span>
            {step.status === 'failed' && step.detail && <span className="truncate font-mono text-xs text-nd-error-fg">{step.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function RunView({ run, onClose }: { run: GuardRun | null; onClose(): void }) {
  const secondsLeft = useSecondsLeft(run?.outcome === 'reverting' ? run.revertAt : null)
  if (!run) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 text-[13px] text-nd-text-muted">
        <Spinner size="sm" />
        Starting…
      </div>
    )
  }
  const live = run.outcome === 'running' || run.outcome === 'reverting'
  return (
    <div className="flex flex-col gap-3">
      <StepList steps={run.steps} />
      {run.outcome !== 'running' && (
        <Notice tone={OUTCOME_TONE[run.outcome]} title={run.outcome === 'reverting' && secondsLeft ? `Reverting in ${secondsLeft} s` : OUTCOME_TITLE[run.outcome]}>
          {run.message}
        </Notice>
      )}
      <div className="flex justify-end">
        <Button variant={live ? 'secondary' : 'primary'} disabled={live} onClick={onClose}>
          {live ? 'Please wait…' : 'Close'}
        </Button>
      </div>
    </div>
  )
}

export function GuardDialog({ guard }: { guard: GuardController }) {
  const { state } = guard
  if (state.phase === 'idle') return null
  const title = state.phase === 'confirm' ? state.preview.title : state.phase === 'running' ? state.run?.title ?? 'Applying' : 'Firewall and SSH change'
  const live = state.phase === 'running' && (!state.run || state.run.outcome === 'running' || state.run.outcome === 'reverting')
  return (
    <Modal open onClose={guard.close} title={title} maxWidth="max-w-xl" closeOnBackdrop={!live} closeOnEscape={!live}>
      {state.phase === 'loading' && (
        <div className="flex items-center justify-center gap-2 py-4 text-[13px] text-nd-text-muted">
          <Spinner size="sm" />
          Checking the server…
        </div>
      )}
      {state.phase === 'error' && (
        <div className="flex flex-col gap-3">
          <Notice tone="error" title="This change was not made">{state.message}</Notice>
          <div className="flex justify-end"><Button onClick={guard.close}>Close</Button></div>
        </div>
      )}
      {state.phase === 'confirm' && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-nd-text-secondary">{state.preview.summary}</p>
          <Notice tone="info" title={`Automatic undo after ${REVERT_SECONDS} seconds`}>
            Shellway backs up the files, starts a timer on the server that puts them back in {REVERT_SECONDS} seconds, applies the change, then logs in again with a new connection on port {state.preview.verifyPort}. Only if that works is the timer cancelled. This session stays open the whole time.
          </Notice>
          {state.preview.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
          <CodeBox label="commands" text={state.preview.commands} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={guard.close}>Cancel</Button>
            <Button variant="primary" onClick={guard.confirm}>Apply with automatic undo</Button>
          </div>
        </div>
      )}
      {state.phase === 'running' && <RunView run={state.run} onClose={guard.close} />}
    </Modal>
  )
}
