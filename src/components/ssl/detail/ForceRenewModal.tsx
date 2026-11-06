import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { FORCE_COPY } from '@/utils/ssl/certbotActions'

interface ForceRenewModalProps {
  command: string
  onConfirm: () => void
  onClose: () => void
}

export function ForceRenewModal({ command, onConfirm, onClose }: ForceRenewModalProps) {
  return (
    <Modal open onClose={onClose} title={FORCE_COPY.title}>
      <p className="text-sm text-nd-text-secondary">{FORCE_COPY.body}</p>
      <p className="mt-3 break-all rounded-md border border-nd-border bg-nd-bg-primary px-3 py-2 font-mono text-xs text-nd-text-secondary">{command}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={onConfirm}>{FORCE_COPY.confirm}</Button>
      </div>
    </Modal>
  )
}
