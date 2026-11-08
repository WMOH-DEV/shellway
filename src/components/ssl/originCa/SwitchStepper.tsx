import { cn } from '@/utils/cn'
import { stepState, SWITCH_STEPS, type SwitchStep } from '@/utils/ssl/switchWizard/steps'
import { StepDot } from '../https/HttpsStepper'

interface SwitchStepperProps {
  current: SwitchStep
  details: Record<SwitchStep, string>
}

export function SwitchStepper({ current, details }: SwitchStepperProps) {
  return (
    <ol aria-label="Switch steps" className="flex flex-col">
      {SWITCH_STEPS.map(({ id, title }, index) => {
        const state = stepState(id, current)
        const isLast = index === SWITCH_STEPS.length - 1
        return (
          <li key={id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3" aria-current={state === 'current' ? 'step' : undefined}>
            <div className="flex flex-col items-center">
              <StepDot index={index} state={state} />
              {!isLast && <span className={cn('my-1 min-h-[18px] w-px flex-1', state === 'done' ? 'bg-nd-success/35' : 'bg-nd-border-hover')} />}
            </div>
            <div className="flex min-w-0 flex-col items-start gap-0.5 pb-[18px] pt-0.5">
              <span className={cn('text-[13px] font-medium', state === 'current' ? 'text-nd-text-primary' : 'text-nd-text-secondary')}>{title}</span>
              <span className="max-w-full truncate text-xs text-nd-text-muted">{details[id]}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
