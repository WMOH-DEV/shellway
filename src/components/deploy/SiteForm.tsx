import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { SiteConfig } from '@/types/deploy'
import { CodeSection, CommandsSection, LayoutSection, SafetySection, WhereSection } from './setup/SiteSections'
import { useSiteDraft } from './setup/useSiteDraft'
import { deployApi } from './useDeploySites'

interface SiteFormProps {
  connectionId: string
  initial: SiteConfig | null
  existingNames: string[]
  onSaved: (site: SiteConfig, isNew: boolean) => void
  onCancel: () => void
}

export function SiteForm({ connectionId, initial, existingNames, onSaved, onCancel }: SiteFormProps) {
  const draft = useSiteDraft(connectionId, initial)
  const { site, isNew } = draft
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (isNew && existingNames.includes(site.name)) {
      setError('A site with this name already exists on this server')
      return
    }
    setSaving(true)
    setError(null)
    const result = await deployApi().save(connectionId, site)
    setSaving(false)
    if (!result.success) {
      setError(result.error ?? 'Could not save')
      return
    }
    onSaved(site, isNew)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-nd-border px-4 py-2.5">
        <Button size="sm" variant="ghost" onClick={onCancel}><ArrowLeft size={13} /> Back</Button>
        <h2 className="text-sm font-semibold text-nd-text-primary">{isNew ? 'Add site' : `Edit ${site.name}`}</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <WhereSection draft={draft} />
          <CodeSection draft={draft} />
          <LayoutSection draft={draft} />
          <CommandsSection draft={draft} connectionId={connectionId} />
          <SafetySection draft={draft} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-nd-border px-4 py-2.5">
        {error && <span className="mr-auto text-xs text-nd-error">{error}</span>}
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save site'}</Button>
      </div>
    </div>
  )
}
