import { Button } from '@/components/ui/Button'
import type { ReviewNotice } from '@/stores/serverActionStore'
import type { ActionPlanView, PlanBlock } from '@/types/server/core'
import { pluralize } from '@/utils/ssl/time'
import { CodeBox, Notice } from '../kit'
import { DrawerBody, DrawerFooter, Spacer } from './DrawerParts'
import { PlanStepCard } from './PlanStepCard'

const SUDOERS_HINT = [
  'echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/shellway',
  'sudo chmod 440 /etc/sudoers.d/shellway',
  'sudo visudo -cf /etc/sudoers.d/shellway'
].join('\n')

const NOTICES: Record<ReviewNotice, { title: string; body: string }> = {
  stale: { title: 'The server changed since you reviewed this. Check the plan again.', body: 'The steps below are the updated plan.' },
  busy: { title: 'Another action is running on this server', body: 'Wait for it to finish, then run this again.' }
}

function BlockedNotice({ blocked }: { blocked: PlanBlock }) {
  return (
    <Notice tone="error" title="This can't run yet">
      <div className="flex flex-col gap-2">
        <span>{blocked.message}</span>
        {blocked.kind === 'sudo' && (
          <>
            <span>Run this once in a terminal on the server to allow passwordless sudo, then review again:</span>
            <CodeBox text={SUDOERS_HINT} label="sudo setup commands" />
          </>
        )}
      </div>
    </Notice>
  )
}

interface ReviewViewProps {
  plan: ActionPlanView
  notice?: ReviewNotice
  onCancel(): void
  onRun(): void
}

export function ReviewView({ plan, notice, onCancel, onRun }: ReviewViewProps) {
  const count = plan.steps.length
  const canRun = !plan.blocked && count > 0
  return (
    <>
      <DrawerBody>
        {notice && <Notice tone="warning" title={NOTICES[notice].title}>{NOTICES[notice].body}</Notice>}
        {plan.blocked && <BlockedNotice blocked={plan.blocked} />}
        {plan.warnings.map((warning) => <Notice key={warning} tone="warning">{warning}</Notice>)}
        <p className="text-xs text-nd-text-muted">{pluralize(count, 'step')}, in this order. Nothing runs until you press Run.</p>
        <ol aria-label="Plan" className="flex flex-col gap-2">
          {plan.steps.map((step, index) => <li key={step.id}><PlanStepCard step={step} index={index} /></li>)}
        </ol>
      </DrawerBody>
      <DrawerFooter>
        <Spacer />
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!canRun} onClick={onRun}>Run {pluralize(count, 'step')}</Button>
      </DrawerFooter>
    </>
  )
}
