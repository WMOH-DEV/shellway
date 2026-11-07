import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { validateGuardRequest, type GuardRequest, type UfwRuleInput } from '@/utils/server/security/guard'
import { FormModal, errorText } from './FormModal'

const PROTOCOLS = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
  { value: 'any', label: 'TCP and UDP' }
]

const ACTIONS = [
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Deny (drop quietly)' },
  { value: 'reject', label: 'Reject (refuse)' },
  { value: 'limit', label: 'Limit (slow down repeated tries)' }
]

const EMPTY: UfwRuleInput = { port: '', proto: 'tcp', from: 'any', action: 'allow', comment: '' }

export function AddRuleModal({ open, onClose, onSubmit }: { open: boolean; onClose(): void; onSubmit(request: GuardRequest): void }) {
  const [rule, setRule] = useState<UfwRuleInput>(EMPTY)
  const [error, setError] = useState('')
  const set = <K extends keyof UfwRuleInput>(key: K, value: UfwRuleInput[K]) => setRule((previous) => ({ ...previous, [key]: value }))

  const submit = () => {
    try {
      const request = validateGuardRequest({ kind: 'ufw.rule.add', rule })
      setError('')
      setRule(EMPTY)
      onSubmit(request)
    } catch (caught) {
      setError(errorText(caught))
    }
  }

  return (
    <FormModal open={open} title="Add firewall rule" submitLabel="Review" error={error} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Port" placeholder="443 or 8000:8100" className="font-mono" value={rule.port} onChange={(event) => set('port', event.target.value)} autoFocus />
        <Select label="Protocol" options={PROTOCOLS} value={rule.proto} onChange={(event) => set('proto', event.target.value as UfwRuleInput['proto'])} />
        <Input label="From" placeholder="any, 203.0.113.10 or 10.0.0.0/8" className="font-mono" value={rule.from} onChange={(event) => set('from', event.target.value)} />
        <Select label="Action" options={ACTIONS} value={rule.action} onChange={(event) => set('action', event.target.value as UfwRuleInput['action'])} />
      </div>
      <Input label="Note (optional)" placeholder="What this port is for" value={rule.comment} onChange={(event) => set('comment', event.target.value)} />
    </FormModal>
  )
}
