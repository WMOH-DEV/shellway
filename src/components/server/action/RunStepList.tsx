import type { ReactNode } from 'react'
import { Check, Loader2, Minus, Undo2, X } from 'lucide-react'
import type { RunStepState, RunStepStatus } from '@/types/server/core'
import { cn } from '@/utils/cn'
import { formatSeconds } from '@/utils/deploy/siteStatus'
import { STEP_STATUS_TEXT, elapsedSeconds } from './runText'
import { StepGroupHeading } from './StepGroupHeading'

const DOTS: Record<RunStepStatus, { icon: ReactNode; tone: string }> = {
  pending: { icon: <Minus size={12} />, tone: 'bg-nd-surface-raised text-nd-text-muted' },
  running: { icon: <Loader2 size={12} className="animate-spin" />, tone: 'bg-nd-accent/15 text-nd-accent' },
  done: { icon: <Check size={12} strokeWidth={2.6} />, tone: 'bg-nd-success/12 text-nd-success-fg' },
  failed: { icon: <X size={12} strokeWidth={2.6} />, tone: 'bg-nd-error/12 text-nd-error-fg' },
  skipped: { icon: <Minus size={12} />, tone: 'bg-nd-surface-raised text-nd-text-muted' },
  'rolled-back': { icon: <Undo2 size={12} />, tone: 'bg-nd-warning/12 text-nd-warning-fg' }
}

const CARDS: Record<RunStepStatus, string> = {
  pending: 'border-nd-surface-raised bg-nd-bg-primary',
  running: 'border-nd-accent/55 bg-nd-accent/[0.06]',
  done: 'border-nd-border bg-nd-surface',
  failed: 'border-nd-error/40 bg-nd-error/[0.06]',
  skipped: 'border-nd-surface-raised bg-nd-bg-primary',
  'rolled-back': 'border-nd-warning/35 bg-nd-surface'
}

const isQuiet = (status: RunStepStatus): boolean => status === 'pending' || status === 'skipped'

function stepTime(step: RunStepState, nowMs: number): string {
  if (isQuiet(step.status) || step.startedAt === null) return ''
  return formatSeconds(elapsedSeconds(step.startedAt, step.finishedAt, nowMs))
}

function StepRow({ steps, index, nowMs }: { steps: RunStepState[]; index: number; nowMs: number }) {
  const step = steps[index]
  const dot = DOTS[step.status]
  const text = STEP_STATUS_TEXT[step.status]
  return (
    <li aria-label={`${step.label}: ${text}`}>
      <StepGroupHeading steps={steps} index={index} />
      <div className={cn('grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] border px-3.5 py-2.5', CARDS[step.status])}>
        <span className={cn('flex h-6 w-6 items-center justify-center rounded-full', dot.tone)} aria-hidden>{dot.icon}</span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={cn('text-[13px] font-medium', isQuiet(step.status) ? 'text-nd-text-muted' : 'text-nd-text-primary')}>{step.label}</span>
          <span className={cn('text-xs', step.status === 'failed' ? 'text-nd-error-fg' : 'text-nd-text-muted')}>{text}</span>
        </div>
        <span className="font-mono text-xs text-nd-text-muted">{stepTime(step, nowMs)}</span>
      </div>
    </li>
  )
}

export function RunStepList({ steps, nowMs }: { steps: RunStepState[]; nowMs: number }) {
  return (
    <ol aria-label="Progress" className="flex flex-col gap-1.5">
      {steps.map((step, index) => <StepRow key={step.id} steps={steps} index={index} nowMs={nowMs} />)}
    </ol>
  )
}
