import { Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { modeLabel, STRICT_LABEL } from '@/utils/ssl/zoneMode/zoneModeView'
import type { ZoneModeFlow } from './useZoneMode'

interface ZoneModeFooterProps {
  flow: ZoneModeFlow
  onCancel: () => void
  onFinished: () => void
}

function ReviewActions({ flow, onCancel }: Pick<ZoneModeFooterProps, 'flow' | 'onCancel'>) {
  return (
    <>
      <Button onClick={onCancel} disabled={flow.busy}>Cancel</Button>
      <div className="flex-1" />
      <Button onClick={flow.recheck} disabled={flow.busy || flow.checking}>
        <RotateCcw size={13} className={flow.checking ? 'animate-spin' : undefined} /> Check again
      </Button>
      <Button variant="primary" onClick={flow.apply} disabled={!flow.canApply}>
        {flow.busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} Set to {STRICT_LABEL}
      </Button>
    </>
  )
}

function DoneActions({ flow, onFinished }: Pick<ZoneModeFooterProps, 'flow' | 'onFinished'>) {
  return (
    <>
      <div className="flex-1" />
      {flow.revertMode && (
        <Button onClick={flow.revert} disabled={flow.busy}>
          {flow.busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Set back to {modeLabel(flow.revertMode)}
        </Button>
      )}
      <Button variant="primary" onClick={onFinished} disabled={flow.busy}>Back to hostnames</Button>
    </>
  )
}

export function ZoneModeFooter({ flow, onCancel, onFinished }: ZoneModeFooterProps) {
  return (
    <footer className="flex flex-wrap items-center gap-2.5 border-t border-nd-border bg-nd-bg-secondary px-7 py-3">
      {flow.change ? <DoneActions flow={flow} onFinished={onFinished} /> : <ReviewActions flow={flow} onCancel={onCancel} />}
    </footer>
  )
}
