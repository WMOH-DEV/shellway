import { Fragment } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/utils/cn'

const STEPS = ['Choose', 'Review plan', 'Install']

function StepCircle({ index, current }: { index: number; current: number }) {
  const done = index < current
  return (
    <span className={cn(
      'flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-semibold',
      done && 'bg-nd-success/12 text-nd-success-fg',
      index === current && 'bg-nd-accent-solid text-white',
      index > current && 'bg-nd-surface-raised text-nd-text-muted'
    )}>
      {done ? <Check size={12} aria-hidden /> : index + 1}
    </span>
  )
}

export function SetupSteps({ current }: { current: number }) {
  return (
    <ol aria-label="Steps" className="flex items-center gap-2.5 text-[13px]">
      {STEPS.map((label, index) => (
        <Fragment key={label}>
          {index > 0 && <li aria-hidden className={cn('h-px w-7', index <= current ? 'bg-nd-success/35' : 'bg-nd-border-hover')} />}
          <li aria-current={index === current ? 'step' : undefined} className={cn('flex items-center gap-2', index === current ? 'font-medium text-nd-text-primary' : 'text-nd-text-muted')}>
            <StepCircle index={index} current={current} />
            {label}
          </li>
        </Fragment>
      ))}
    </ol>
  )
}
