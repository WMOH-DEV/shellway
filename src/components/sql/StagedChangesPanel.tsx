import { memo, useState, useCallback } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { generateSQL } from '@/utils/sqlStatementGenerator'
import type { StagedChange, DatabaseType } from '@/types/sql'

interface StagedChangesPanelProps {
  changes: StagedChange[]
  onUndo: (id: string) => void
  onDiscardAll: () => void
  onApplyAll: () => void
  dbType: DatabaseType
}

// ── Change type icon ──

const changeIcons: Record<string, React.ReactNode> = {
  update: <Pencil size={12} className="text-nd-warning" />,
  insert: <Plus size={12} className="text-nd-success" />,
  delete: <Trash2 size={12} className="text-nd-error" />,
}

const changeVariants: Record<string, 'warning' | 'success' | 'error'> = {
  update: 'warning',
  insert: 'success',
  delete: 'error',
}

// ── Single change row ──

interface ChangeRowProps {
  change: StagedChange
  index: number
  dbType: DatabaseType
  onUndo: (id: string) => void
}

const ChangeRow = memo(function ChangeRow({
  change,
  index,
  dbType,
  onUndo,
}: ChangeRowProps) {
  const sql = generateSQL(change, dbType)
  const handleUndo = useCallback(() => onUndo(change.id), [onUndo, change.id])

  return (
    <div className="group flex items-start gap-2 px-3 py-2 hover:bg-nd-surface-hover transition-colors">
      <span className="text-2xs text-nd-text-muted mt-0.5 min-w-[1.25rem] text-right">
        {index + 1}.
      </span>
      <span className="mt-0.5">{changeIcons[change.type]}</span>
      <pre className="flex-1 text-xs text-nd-text-secondary font-mono whitespace-pre-wrap break-all leading-relaxed">
        {sql}
      </pre>
      <button
        onClick={handleUndo}
        className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded text-nd-text-muted hover:text-nd-error hover:bg-nd-error/10 transition-all"
        title="Undo this change"
      >
        <Undo2 size={12} />
      </button>
    </div>
  )
})

// ── Panel ──

export const StagedChangesPanel = memo(function StagedChangesPanel({
  changes,
  onUndo,
  onDiscardAll,
  onApplyAll,
  dbType,
}: StagedChangesPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  const toggleCollapse = useCallback(() => setCollapsed((c) => !c), [])
  const handleApply = useCallback(() => onApplyAll(), [onApplyAll])
  const handleDiscard = useCallback(() => onDiscardAll(), [onDiscardAll])

  if (changes.length === 0) return null

  // Count by type
  const counts = changes.reduce(
    (acc, c) => {
      acc[c.type] = (acc[c.type] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  return (
    <div className="border-t border-nd-border bg-nd-bg-secondary">
      {/* Header */}
      <button
        onClick={toggleCollapse}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold text-nd-text-primary hover:bg-nd-surface-hover transition-colors"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span>{changes.length} Pending {changes.length === 1 ? 'Change' : 'Changes'}</span>

        <div className="flex items-center gap-1 ml-2">
          {Object.entries(counts).map(([type, count]) => (
            <Badge key={type} variant={changeVariants[type] ?? 'default'}>
              {count} {type}
            </Badge>
          ))}
        </div>
      </button>

      {/* Body */}
      {!collapsed && (
        <>
          <div className="max-h-48 overflow-auto divide-y divide-nd-border/50 border-t border-nd-border">
            {changes.map((change, i) => (
              <ChangeRow
                key={change.id}
                change={change}
                index={i}
                dbType={dbType}
                onUndo={onUndo}
              />
            ))}
          </div>

          {/* Footer actions */}
          <div
            className={cn(
              'flex items-center justify-end gap-2 px-3 py-2 border-t border-nd-border'
            )}
          >
            <Button size="sm" variant="ghost" onClick={handleDiscard}>
              Discard All
            </Button>
            <Button size="sm" variant="primary" onClick={handleApply}>
              Apply All
              <kbd className="ml-1 text-2xs opacity-70">&#8984;&#9166;</kbd>
            </Button>
          </div>
        </>
      )}
    </div>
  )
})
