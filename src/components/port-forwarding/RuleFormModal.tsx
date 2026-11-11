import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Toggle } from '@/components/ui/Toggle'
import type { PortForwardRule } from '@/types/session'
import type { PortForwardType } from '@/types/portForward'
import { emptyForm, formFromRule, hasDestination, validateForm, type RuleForm, type RuleFormErrors } from './portForwardRules'

interface RuleFormModalProps {
  open: boolean
  rule: PortForwardRule | null
  otherRules: PortForwardRule[]
  onClose: () => void
  onSave: (form: RuleForm) => void
}

const TYPE_OPTIONS: { value: PortForwardType; label: string }[] = [
  { value: 'local', label: 'Local: reach a server port from this computer' },
  { value: 'remote', label: 'Remote: let the server reach a port on this computer' },
  { value: 'dynamic', label: 'SOCKS proxy: send apps through the server' }
]

const LABELS: Record<PortForwardType, { source: string; destination: string }> = {
  local: { source: 'Listen on this computer', destination: 'Forward to, as seen from the server' },
  remote: { source: 'Listen on the server', destination: 'Forward to, on this computer' },
  dynamic: { source: 'Listen on this computer', destination: '' }
}

export function RuleFormModal({ open, rule, otherRules, onClose, onSave }: RuleFormModalProps) {
  const [form, setForm] = useState<RuleForm>(emptyForm)
  const [errors, setErrors] = useState<RuleFormErrors>({})

  useEffect(() => {
    if (!open) return
    setForm(rule ? formFromRule(rule) : emptyForm())
    setErrors({})
  }, [open, rule])

  const update = (change: Partial<RuleForm>) => setForm((current) => ({ ...current, ...change }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateForm(form, otherRules)
    setErrors(found)
    if (Object.keys(found).length === 0) onSave(form)
  }

  const labels = LABELS[form.type]

  return (
    <Modal open={open} onClose={onClose} title={rule ? 'Edit rule' : 'New rule'} maxWidth="max-w-md">
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Select
          label="Type"
          value={form.type}
          onChange={(event) => update({ type: event.target.value as PortForwardType })}
          options={TYPE_OPTIONS}
        />
        <Input
          label="Name (optional)"
          placeholder="e.g. Production database"
          value={form.name}
          onChange={(event) => update({ name: event.target.value })}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-nd-text-secondary">{labels.source}</legend>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <Input
              aria-label="Listen host"
              value={form.sourceHost}
              onChange={(event) => update({ sourceHost: event.target.value })}
              error={errors.sourceHost}
            />
            <Input
              aria-label="Listen port"
              inputMode="numeric"
              placeholder={form.type === 'dynamic' ? '1080' : '7777'}
              value={form.sourcePort}
              onChange={(event) => update({ sourcePort: event.target.value })}
              error={errors.sourcePort}
              autoFocus
            />
          </div>
        </fieldset>
        {hasDestination(form.type) && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs font-medium text-nd-text-secondary">{labels.destination}</legend>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <Input
                aria-label="Destination host"
                value={form.destinationHost}
                onChange={(event) => update({ destinationHost: event.target.value })}
                error={errors.destinationHost}
              />
              <Input
                aria-label="Destination port"
                inputMode="numeric"
                placeholder="3306"
                value={form.destinationPort}
                onChange={(event) => update({ destinationPort: event.target.value })}
                error={errors.destinationPort}
              />
            </div>
          </fieldset>
        )}
        <Toggle checked={form.autoStart} onChange={(autoStart) => update({ autoStart })} label="Start when this server connects" />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {rule ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
