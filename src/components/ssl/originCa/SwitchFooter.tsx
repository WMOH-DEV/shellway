import type { ReactNode } from 'react'
import { ArrowRight, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { SwitchFlow } from './useSwitchFlow'

interface SwitchFooterProps {
  flow: SwitchFlow
  onCancel: () => void
  onFinished: () => void
}

const Hint = ({ children }: { children: ReactNode }) => <span className="text-xs text-nd-text-muted">{children}</span>

const UNDO_HINT = 'Undo stays available while the backup exists'

function ExplainActions({ flow, onCancel }: { flow: SwitchFlow; onCancel: () => void }) {
  return (
    <>
      <Button onClick={onCancel}>Cancel</Button>
      <div className="flex-1" />
      <Hint>Nothing changes in nginx yet</Hint>
      <Button variant="primary" onClick={() => void flow.prepare()} disabled={flow.check.blockedReason !== null}>
        Continue <ArrowRight size={13} />
      </Button>
    </>
  )
}

function PrepareActions({ flow }: { flow: SwitchFlow }) {
  const failed = flow.prepareError !== null
  return (
    <>
      <Button onClick={flow.back} disabled={flow.busy}>Back</Button>
      <div className="flex-1" />
      {failed
        ? <Button variant="primary" onClick={() => void flow.prepare()} disabled={flow.check.blockedReason !== null}><RotateCcw size={13} /> Try again</Button>
        : <Hint>Working on the server and Cloudflare</Hint>}
    </>
  )
}

function ReviewActions({ flow, onCancel }: { flow: SwitchFlow; onCancel: () => void }) {
  return (
    <>
      <Button onClick={flow.back}>Back</Button>
      <div className="flex-1" />
      <Hint>{UNDO_HINT}</Hint>
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant="primary" onClick={() => void flow.apply()} disabled={flow.check.blockedReason !== null}>
        <ShieldCheck size={13} /> Apply and verify
      </Button>
    </>
  )
}

function FinishedActions({ flow, onFinished }: { flow: SwitchFlow; onFinished: () => void }) {
  const { applyResult, undo } = flow
  const canUndo = applyResult?.ok === true && undo.result?.ok !== true
  return (
    <>
      <div className="flex-1" />
      {canUndo && <Hint>{UNDO_HINT}</Hint>}
      {canUndo && (
        <Button onClick={() => void undo.undo()} disabled={undo.run.running}>
          {undo.run.running ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Undo switch
        </Button>
      )}
      <Button variant="primary" onClick={onFinished} disabled={undo.run.running}>Back to hostnames</Button>
    </>
  )
}

function DroppedActions({ onFinished }: { onFinished: () => void }) {
  return (
    <>
      <div className="flex-1" />
      <Button variant="primary" onClick={onFinished}>Back to hostnames</Button>
    </>
  )
}

function ApplyActions({ flow, onCancel, onFinished }: SwitchFooterProps) {
  if (flow.applyResult) return <FinishedActions flow={flow} onFinished={onFinished} />
  if (flow.applyError !== null) return <DroppedActions onFinished={onFinished} />
  return (
    <>
      <Button disabled>Back</Button>
      <div className="flex-1" />
      <Hint>Applying. Leaving is disabled until it finishes.</Hint>
      <Button onClick={onCancel} disabled>Cancel</Button>
      <Button variant="primary" disabled>
        <Loader2 size={13} className="animate-spin" /> Applying…
      </Button>
    </>
  )
}

function PhaseActions({ flow, onCancel, onFinished }: SwitchFooterProps) {
  if (flow.phase === 'explain') return <ExplainActions flow={flow} onCancel={onCancel} />
  if (flow.phase === 'prepare') return <PrepareActions flow={flow} />
  if (flow.phase === 'review') return <ReviewActions flow={flow} onCancel={onCancel} />
  return <ApplyActions flow={flow} onCancel={onCancel} onFinished={onFinished} />
}

export function SwitchFooter(props: SwitchFooterProps) {
  return (
    <footer className="flex flex-wrap items-center gap-2.5 border-t border-nd-border bg-nd-bg-secondary px-7 py-3">
      <PhaseActions {...props} />
    </footer>
  )
}
