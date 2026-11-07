import type { ReactNode } from 'react'
import { Check, Loader2, Minus, X } from 'lucide-react'
import type { PlanAction, PlanActionId, RunRecord, RunStep } from '@/types/createSite'
import { cn } from '@/utils/cn'
import { formatSeconds } from '@/utils/deploy/siteStatus'
import { actionTitle } from '@/utils/createSite/plan'
import { progressState, stepSeconds, type ProgressState } from '@/utils/createSite/runView'
import { driverFor } from '@/utils/createSite/wizard'

interface RunProgressProps {
  record: RunRecord
  plan: PlanAction[] | null
  nowMs: number
}

const STATE_TEXT: Record<ProgressState, string> = {
  done: 'Done',
  running: 'Running…',
  waiting: 'Waiting',
  failed: 'Failed',
  skipped: 'Skipped'
}

const DOTS: Record<ProgressState, { icon: ReactNode; tone: string }> = {
  done: { icon: <Check size={12} strokeWidth={2.6} />, tone: 'bg-nd-success/12 text-nd-success-fg' },
  running: { icon: <Loader2 size={12} className="animate-spin" />, tone: 'bg-nd-accent/15 text-nd-accent' },
  waiting: { icon: <Minus size={12} />, tone: 'bg-nd-surface-raised text-nd-text-muted' },
  failed: { icon: <X size={12} strokeWidth={2.6} />, tone: 'bg-nd-error/12 text-nd-error-fg' },
  skipped: { icon: <Minus size={12} />, tone: 'bg-nd-surface-raised text-nd-text-muted' }
}

const CARDS: Record<ProgressState, string> = {
  done: 'border-nd-border bg-nd-surface',
  running: 'border-nd-accent/55 bg-nd-accent/[0.06]',
  waiting: 'border-nd-surface-raised bg-nd-bg-primary',
  failed: 'border-nd-error/40 bg-nd-error/[0.06]',
  skipped: 'border-nd-surface-raised bg-nd-bg-primary'
}

const isQuiet = (state: ProgressState): boolean => state === 'waiting' || state === 'skipped'

function subLine(state: ProgressState, summary: string | undefined): string {
  return state === 'failed' || state === 'skipped' ? STATE_TEXT[state] : summary ?? STATE_TEXT[state]
}

function stepTime(step: RunStep, state: ProgressState, nowMs: number): string {
  if (isQuiet(state)) return ''
  const seconds = stepSeconds(step, nowMs)
  return seconds === null ? '' : formatSeconds(seconds)
}

function ProgressItem({ step, state, title, summary, nowMs }: { step: RunStep; state: ProgressState; title: string; summary: string | undefined; nowMs: number }) {
  const dot = DOTS[state]
  return (
    <li aria-label={`${title}: ${STATE_TEXT[state]}`} className={cn('grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] border px-3.5 py-2.5', CARDS[state])}>
      <span className={cn('flex h-6 w-6 items-center justify-center rounded-full', dot.tone)} aria-hidden>{dot.icon}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('text-[13px] font-medium', isQuiet(state) ? 'text-nd-text-muted' : 'text-nd-text-primary')}>{title}</span>
        <span className={cn('truncate text-xs', state === 'failed' ? 'text-nd-error-fg' : 'text-nd-text-muted')}>{subLine(state, summary)}</span>
      </div>
      <span className="font-mono text-xs text-nd-text-muted">{stepTime(step, state, nowMs)}</span>
    </li>
  )
}

export function RunProgress({ record, plan, nowMs }: RunProgressProps) {
  const driver = driverFor(record.server)
  const planned = new Map<PlanActionId, PlanAction>(plan?.map((action) => [action.id, action]) ?? [])
  return (
    <ol aria-label="Progress" className="flex flex-col gap-1.5">
      {record.steps.map((step) => (
        <ProgressItem
          key={step.id}
          step={step}
          state={progressState(step, record)}
          title={planned.get(step.id)?.title ?? actionTitle(step.id, driver)}
          summary={planned.get(step.id)?.summary}
          nowMs={nowMs}
        />
      ))}
    </ol>
  )
}
