import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { deployApi } from '@/components/deploy/useDeploySites'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Chip, SectionCard } from '../../kit'

export function CloudflareTokenCard({ onOpen }: { onOpen(): void }) {
  return (
    <SectionCard title="Cloudflare token">
      <p className="text-[13px] text-nd-text-muted">
        Used to check how Cloudflare serves your sites, switch them to an Origin certificate, and add DNS records when you create a site. To let Create site add DNS records, give the token the <span className="font-medium text-nd-text-secondary">Create DNS records</span> permission group (<span className="font-mono text-xs">Zone › DNS › Edit</span>).
      </p>
      <div>
        <Button onClick={onOpen}>Manage Cloudflare token<ChevronRight size={14} /></Button>
      </div>
    </SectionCard>
  )
}

function GithubTokenForm({ onSaved, onCancel }: { onSaved(): void; onCancel?(): void }) {
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const save = async () => {
    setSaving(true)
    setError(undefined)
    const result = await deployApi().saveGithubToken(token.trim())
    setSaving(false)
    if (!result.success) return setError(result.error ?? 'Could not save the token')
    setToken('')
    onSaved()
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <Input
        type="password"
        label="GitHub token"
        value={token}
        error={error}
        autoComplete="off"
        onChange={(e) => setToken(e.target.value)}
      />
      <p className="text-2xs text-nd-text-muted">Use a fine-grained token for the repo with Administration: read and write.</p>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={token.trim() === '' || saving}>Save token</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}

export function GithubCard() {
  const [saved, setSaved] = useState<boolean | null>(null)
  const [replacing, setReplacing] = useState(false)
  const [forgetError, setForgetError] = useState<string>()

  useEffect(() => {
    void deployApi().githubTokenSaved().then((result) => setSaved(result.success && result.data === true))
  }, [])

  const forget = async () => {
    const result = await deployApi().clearGithubToken()
    if (!result.success) return setForgetError(result.error ?? 'Could not forget the token')
    setForgetError(undefined)
    setReplacing(false)
    setSaved(false)
  }

  const onSaved = () => {
    setForgetError(undefined)
    setReplacing(false)
    setSaved(true)
  }

  return (
    <SectionCard title="GitHub login" aside={saved !== null && <Chip dense tone={saved ? 'success' : 'neutral'}>{saved ? 'Token saved' : 'No token'}</Chip>}>
      <p className="text-[13px] text-nd-text-muted">
        {saved
          ? 'Shellway uses your saved GitHub token to add read-only deploy keys to your repositories. It is stored on this PC and never sent to your servers.'
          : 'No GitHub token is saved. Add one here, or when you set up a deploy key for a site.'}
      </p>
      {saved === false && <GithubTokenForm onSaved={onSaved} />}
      {saved && replacing && <GithubTokenForm onSaved={onSaved} onCancel={() => setReplacing(false)} />}
      {saved && !replacing && (
        <div className="flex gap-2">
          <Button onClick={() => setReplacing(true)}>Replace</Button>
          <Button variant="ghost" className="text-nd-error-fg hover:text-nd-error-fg" onClick={() => void forget()}>Forget</Button>
        </div>
      )}
      {forgetError && <p className="text-2xs text-nd-error-fg">{forgetError}</p>}
    </SectionCard>
  )
}
