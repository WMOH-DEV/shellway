import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

interface FormModalProps {
  open: boolean
  title: string
  submitLabel: string
  error: string
  onClose(): void
  onSubmit(): void
  children: ReactNode
}

export function FormModal({ open, title, submitLabel, error, onClose, onSubmit, children }: FormModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
        {children}
        {error && <p className="text-xs text-nd-error-fg">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">{submitLabel}</Button>
        </div>
      </form>
    </Modal>
  )
}

export const errorText = (caught: unknown): string => (caught instanceof Error ? caught.message : String(caught))
