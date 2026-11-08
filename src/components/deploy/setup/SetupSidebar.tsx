import { Check } from 'lucide-react'
import { cn } from '@/utils/cn'
import { SETUP_STEPS, STEP_TITLES, type FirstDeployPlan, type PlanLine, type SetupStep } from '@/utils/deploy/setupFlow'

interface StepperProps {
  current: SetupStep
  details: Record<SetupStep, string>
  onSelect: (step: SetupStep) => void
}

function StepDot({ index, state }: { index: number; state: 'done' | 'current' | 'todo' }) {
  const tone = {
    done: 'bg-nd-success/12 text-nd-success-fg',
    current: 'bg-nd-accent-solid text-white',
    todo: 'bg-nd-surface-raised text-nd-text-muted'
  }[state]
  return (
    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', tone)}>
      {state === 'done' ? <Check size={12} strokeWidth={2.6} /> : index + 1}
    </span>
  )
}

export function Stepper({ current, details, onSelect }: StepperProps) {
  const currentIndex = SETUP_STEPS.indexOf(current)
  return (
    <ol aria-label="Setup steps" className="flex flex-col">
      {SETUP_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo'
        const isLast = index === SETUP_STEPS.length - 1
        return (
          <li key={step} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3" aria-current={state === 'current' ? 'step' : undefined}>
            <div className="flex flex-col items-center">
              <StepDot index={index} state={state} />
              {!isLast && <span className={cn('my-1 min-h-[18px] w-px flex-1', state === 'done' ? 'bg-nd-success/35' : 'bg-nd-border-hover')} />}
            </div>
            <button
              type="button"
              disabled={state !== 'done'}
              onClick={() => onSelect(step)}
              className="flex min-w-0 flex-col items-start gap-0.5 pb-[18px] pt-0.5 text-left disabled:cursor-default"
            >
              <span className={cn('text-[13px] font-medium', state === 'current' ? 'text-nd-text-primary' : 'text-nd-text-secondary')}>{STEP_TITLES[step]}</span>
              <span className="max-w-full truncate text-xs text-nd-text-muted">{details[step]}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function PlanText({ line }: { line: PlanLine }) {
  return (
    <>
      {line.map((part, index) =>
        typeof part === 'string'
          ? <span key={index}>{part}</span>
          : <span key={index} className="break-all font-mono text-[11.5px]">{part.code}</span>
      )}
    </>
  )
}

export function FirstDeployCard({ plan }: { plan: FirstDeployPlan }) {
  return (
    <section aria-label="First deploy will" className="mt-auto flex flex-col gap-2.5 rounded-[10px] border border-nd-border bg-nd-surface p-3.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-nd-text-dim">First deploy will</span>
      <ol className="flex list-decimal flex-col gap-1.5 pl-[18px] text-[12.5px] text-nd-text-secondary">
        {plan.lines.map((line, index) => <li key={index}><PlanText line={line} /></li>)}
      </ol>
      {plan.footer && (
        <span className="border-t border-nd-border pt-2 text-xs text-nd-text-muted"><PlanText line={plan.footer} /></span>
      )}
    </section>
  )
}
