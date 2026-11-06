import { Check } from 'lucide-react'
import { cn } from '@/utils/cn'
import { HTTPS_STEPS, stepState, type HttpsStep, type StepState } from '@/utils/ssl/addHttps/steps'

interface HttpsStepperProps {
  current: HttpsStep
  details: Record<HttpsStep, string>
  prepareSkipped: boolean
  canNavigate: boolean
  onSelect: (step: HttpsStep) => void
}

const DOT_TONE: Record<StepState, string> = {
  done: 'bg-nd-success/[.14] text-nd-success',
  current: 'bg-nd-accent text-white',
  todo: 'bg-nd-bg-tertiary text-nd-text-muted'
}

export function StepDot({ index, state }: { index: number; state: StepState }) {
  return (
    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', DOT_TONE[state])}>
      {state === 'done' ? <Check size={12} strokeWidth={2.6} /> : index + 1}
    </span>
  )
}

export function HttpsStepper({ current, details, prepareSkipped, canNavigate, onSelect }: HttpsStepperProps) {
  return (
    <ol aria-label="Add HTTPS steps" className="flex flex-col">
      {HTTPS_STEPS.map(({ id, title }, index) => {
        const state = stepState(id, current, prepareSkipped)
        const isLast = index === HTTPS_STEPS.length - 1
        return (
          <li key={id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3" aria-current={state === 'current' ? 'step' : undefined}>
            <div className="flex flex-col items-center">
              <StepDot index={index} state={state} />
              {!isLast && <span className={cn('my-1 min-h-[18px] w-px flex-1', state === 'done' ? 'bg-nd-success/35' : 'bg-nd-border')} />}
            </div>
            <button
              type="button"
              disabled={!canNavigate || state !== 'done' || (id === 'prepare' && prepareSkipped)}
              onClick={() => onSelect(id)}
              className="flex min-w-0 flex-col items-start gap-0.5 pb-[18px] pt-0.5 text-left disabled:cursor-default"
            >
              <span className={cn('text-[13px] font-medium', state === 'current' ? 'text-nd-text-primary' : 'text-nd-text-secondary')}>{title}</span>
              <span className="max-w-full truncate text-xs text-nd-text-muted">{details[id]}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
