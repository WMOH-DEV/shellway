import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { changesLabel } from '@/utils/deploy/pipelineDraft'

interface SaveBarProps {
  changes: number
  issue: string | null
  saving: boolean
  onDiscard: () => void
  onSave: () => void
}

export function SaveBar({ changes, issue, saving, onDiscard, onSave }: SaveBarProps) {
  const dirty = changes > 0
  return (
    <div className="flex items-center gap-2.5 border-t border-nd-border bg-nd-bg-secondary px-6 py-3">
      <span className={cn('h-1.5 w-1.5 rounded-full', dirty ? 'bg-nd-warning' : 'bg-nd-success')} />
      <span className="text-sm text-nd-text-secondary">{changesLabel(changes)}</span>
      {dirty && <span className="text-sm text-nd-text-muted">· applies from the next deploy</span>}
      {dirty && issue && <span className="ml-2 text-xs text-nd-error">{issue}</span>}
      <div className="flex-1" />
      <Button variant="secondary" disabled={!dirty || saving} onClick={onDiscard}>Discard</Button>
      <Button variant="primary" disabled={!dirty || saving || issue !== null} onClick={onSave}>
        {saving ? 'Saving…' : 'Save pipeline'}
      </Button>
    </div>
  )
}
