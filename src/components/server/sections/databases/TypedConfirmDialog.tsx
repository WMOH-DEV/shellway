import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { DialogFooter, Field, TextInput } from './DialogParts'

interface Props {
  title: string
  name: string
  confirmLabel: string
  children: ReactNode
  onClose(): void
  onConfirm(): void
}

export function TypedConfirmDialog({ title, name, confirmLabel, children, onClose, onConfirm }: Props) {
  const [typed, setTyped] = useState('')
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="flex flex-col gap-4 text-[13px] text-nd-text-secondary">
        {children}
        <Field label={`Type ${name} to confirm`}>
          <TextInput mono value={typed} onChange={setTyped} aria-label="Confirmation" autoFocus />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={typed !== name} onClick={onConfirm}>{confirmLabel}</Button>
      </DialogFooter>
    </Modal>
  )
}
