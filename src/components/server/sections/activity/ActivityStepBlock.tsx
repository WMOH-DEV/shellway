import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy } from 'lucide-react'
import { copyText } from '@/components/deploy/copyText'
import type { ActivityStep, RunStepStatus } from '@/types/server/core'
import { Chip, StatusDot, type KitTone } from '../../kit'

const STEP_TONE: Record<RunStepStatus, KitTone> = {
  pending: 'neutral',
  running: 'info',
  done: 'success',
  failed: 'error',
  skipped: 'neutral',
  'rolled-back': 'warning'
}

export function ActivityStepBlock({ step }: { step: ActivityStep }) {
  const [open, setOpen] = useState(step.status === 'failed')
  const output = step.output.trimEnd()
  const copy = () => void copyText(output ? `${step.display}\n${output}` : step.display)

  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-md py-0.5 text-left text-[13px] text-nd-text-secondary hover:text-nd-text-primary">
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        <StatusDot tone={STEP_TONE[step.status]} label={step.status} />
        <span className="min-w-0 truncate">{step.label}</span>
        {step.status === 'rolled-back' && <Chip dense tone="warning">rolled back</Chip>}
        {step.exitCode !== null && step.exitCode !== 0 && <Chip dense mono tone="error">exit {step.exitCode}</Chip>}
      </button>
      {open && (
        <div className="flex items-start gap-2 rounded-lg border border-nd-border bg-nd-bg-sunken px-3 py-2.5">
          <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-[1.7] text-nd-text-secondary">
            <span className="text-nd-info-fg">{step.display.split('\n').map((line) => `$ ${line}`).join('\n')}</span>
            {output && `\n${output}`}
          </pre>
          <button type="button" aria-label={`Copy ${step.label}`} onClick={copy} className="rounded-md p-1 text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
            <Copy size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
