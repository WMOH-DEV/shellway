import { StepHeading } from '@/components/ssl/https/StepHeading'
import type { PlanAction } from '@/types/createSite'
import { stepForAction, type WizardStep } from '@/utils/createSite/wizard'
import { pluralize } from '@/utils/ssl/time'
import { Callout } from './Callout'
import { PlanActionCard } from './PlanActionCard'

interface ReviewStepProps {
  plan: PlanAction[] | string
  fullSudo: boolean
  onEdit: (step: WizardStep) => void
}

function NeedsYouCount({ plan }: { plan: PlanAction[] }) {
  const count = plan.filter((action) => action.chip === 'needs you').length
  if (count === 0) return null
  return <span className="rounded-md bg-nd-warning/12 px-2 py-0.5 text-xs font-medium text-nd-warning-fg">{pluralize(count, 'step')} {count === 1 ? 'needs' : 'need'} you</span>
}

export function ReviewStep({ plan, fullSudo, onEdit }: ReviewStepProps) {
  if (typeof plan === 'string') {
    return (
      <div className="flex flex-col gap-5">
        <StepHeading title="Review the plan" subtitle="Something in the earlier steps needs fixing first." />
        <Callout tone="error">{plan}</Callout>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <StepHeading title="Review the plan" subtitle={`${pluralize(plan.length, 'step')}, in this order. Open any step to see exactly what runs.`} />
        <div className="flex-1" />
        <NeedsYouCount plan={plan} />
      </div>
      {!fullSudo && (
        <Callout tone="warning">
          This server has no full passwordless sudo, so the steps that run as root will need to be run by hand. Open each step to copy its commands.
        </Callout>
      )}
      <ol aria-label="Plan" className="flex flex-col gap-2">
        {plan.map((action, index) => (
          <li key={action.id}><PlanActionCard action={action} index={index} onEdit={() => onEdit(stepForAction(action.id))} /></li>
        ))}
      </ol>
    </div>
  )
}
