import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { RunRecord } from '@/types/createSite'
import { removalSteps, type RemovalStep } from '@/utils/createSite/removal'
import { driverFor } from '@/utils/createSite/wizard'

interface RemoveConfirmProps {
  record: RunRecord
  onConfirm: () => void
  onClose: () => void
}

function plannedRemoval(record: RunRecord): RemovalStep[] | string {
  try {
    return removalSteps(record, driverFor(record.server))
  } catch (err) {
    return (err as Error).message
  }
}

function RemovalList({ steps }: { steps: RemovalStep[] }) {
  if (steps.length === 0) return <p className="text-sm text-nd-text-secondary">This run has not created anything yet, so nothing on the server changes.</p>
  return (
    <>
      <p className="text-sm text-nd-text-secondary">Shellway removes only what this run created, in this order:</p>
      <ol aria-label="Will be removed" className="flex list-decimal flex-col gap-1 pl-5 font-mono text-xs text-nd-text-primary">
        {steps.map((step) => <li key={step.title}>{step.title}</li>)}
      </ol>
    </>
  )
}

export function RemoveConfirm({ record, onConfirm, onClose }: RemoveConfirmProps) {
  const steps = plannedRemoval(record)
  const blocked = typeof steps === 'string'
  return (
    <Modal open onClose={onClose} title="Remove what this wizard created?">
      <div className="flex flex-col gap-3">
        {blocked ? <p role="alert" className="text-sm text-nd-error-fg">{steps}</p> : <RemovalList steps={steps} />}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={blocked} onClick={onConfirm}>Remove</Button>
      </div>
    </Modal>
  )
}
