import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

interface TokenFormProps {
  busy: boolean
  submitLabel: string
  onSubmit: (token: string) => Promise<boolean>
  onCancel?: () => void
}

export function TokenForm({ busy, submitLabel, onSubmit, onCancel }: TokenFormProps) {
  const [token, setToken] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (await onSubmit(token.trim())) setToken('')
  }

  return (
    <form className="flex items-end gap-2" onSubmit={(event) => void submit(event)}>
      <div className="min-w-0 flex-1">
        <Input
          type="password"
          label="API token"
          autoComplete="off"
          spellCheck={false}
          className="bg-nd-bg-primary font-mono text-xs"
          placeholder="Paste the token Cloudflare shows once"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <Button variant="primary" type="submit" disabled={busy || token.trim() === ''}>{busy ? 'Checking…' : submitLabel}</Button>
      {onCancel && <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>}
    </form>
  )
}
