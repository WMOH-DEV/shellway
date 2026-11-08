import { cn } from '@/utils/cn'
import { STEP_TITLES, WIZARD_STEPS, type WizardStep } from '@/utils/createSite/wizard'
import type { StepState } from '@/utils/ssl/addHttps/steps'
import { StepDot } from '@/components/ssl/https/HttpsStepper'

export type StepperStep = WizardStep | 'create'

const STEPS: StepperStep[] = [...WIZARD_STEPS, 'create']

interface CreateSiteStepperProps {
  current: WizardStep
  details: Record<StepperStep, string>
  onSelect: (step: WizardStep) => void
}

function stateOf(index: number, currentIndex: number): StepState {
  if (index < currentIndex) return 'done'
  return index === currentIndex ? 'current' : 'todo'
}

export function CreateSiteStepper({ current, details, onSelect }: CreateSiteStepperProps) {
  const currentIndex = STEPS.indexOf(current)
  return (
    <ol aria-label="Create site steps" className="flex flex-col">
      {STEPS.map((step, index) => {
        const state = stateOf(index, currentIndex)
        const isLast = index === STEPS.length - 1
        return (
          <li key={step} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3" aria-current={state === 'current' ? 'step' : undefined}>
            <div className="flex flex-col items-center">
              <StepDot index={index} state={state} />
              {!isLast && <span className={cn('my-1 min-h-[18px] w-px flex-1', state === 'done' ? 'bg-nd-success/35' : 'bg-nd-border-hover')} />}
            </div>
            <button
              type="button"
              disabled={state !== 'done' || step === 'create'}
              onClick={() => step !== 'create' && onSelect(step)}
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
