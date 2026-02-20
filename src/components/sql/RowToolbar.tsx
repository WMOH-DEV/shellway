import { memo, useCallback } from 'react'
import { Plus, Trash2, Check, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'

interface RowToolbarProps {
  onInsertRow: () => void
  onDeleteRow: () => void
  onApplyAll: () => void
  onDiscardAll: () => void
  pendingChanges: number
  hasSelection: boolean
}

export const RowToolbar = memo(function RowToolbar({
  onInsertRow,
  onDeleteRow,
  onApplyAll,
  onDiscardAll,
  pendingChanges,
  hasSelection,
}: RowToolbarProps) {
  const handleApply = useCallback(() => onApplyAll(), [onApplyAll])
  const handleDiscard = useCallback(() => onDiscardAll(), [onDiscardAll])
  const handleInsert = useCallback(() => onInsertRow(), [onInsertRow])
  const handleDelete = useCallback(() => onDeleteRow(), [onDeleteRow])

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-nd-border bg-nd-bg-secondary">
      {/* Row operations */}
      <Button size="sm" variant="ghost" onClick={handleInsert}>
        <Plus size={14} />
        Insert Row
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={handleDelete}
        disabled={!hasSelection}
      >
        <Trash2 size={14} />
        Delete Row
      </Button>

      {/* Separator */}
      <div className="w-px h-4 bg-nd-border mx-1" />

      {/* Apply / Discard */}
      <Button
        size="sm"
        variant="primary"
        onClick={handleApply}
        disabled={pendingChanges === 0}
        className={cn(pendingChanges > 0 && 'animate-pulse-subtle')}
      >
        <Check size={14} />
        Apply All
        <kbd className="ml-1 text-2xs opacity-70">&#8984;&#9166;</kbd>
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={handleDiscard}
        disabled={pendingChanges === 0}
      >
        <X size={14} />
        Discard All
      </Button>

      {/* Pending changes badge */}
      {pendingChanges > 0 && (
        <Badge variant="warning" className="ml-1.5">
          {pendingChanges} pending {pendingChanges === 1 ? 'change' : 'changes'}
        </Badge>
      )}
    </div>
  )
})
