import { memo, useCallback } from 'react'
import { AlertTriangle, Filter, GitCommitHorizontal, Save, Undo2, Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Badge } from '@/components/ui/Badge'

interface SQLStatusBarProps {
  dbType?: string
  database?: string
  table?: string
  rowInfo?: string
  executionTime?: number
  filterCount?: number
  changeCount?: number
  isProduction?: boolean
  isSaving?: boolean
  onSave?: () => void
  onDiscard?: () => void
}

export const SQLStatusBar = memo(function SQLStatusBar({
  dbType,
  database,
  table,
  rowInfo,
  executionTime,
  filterCount,
  changeCount,
  isProduction,
  isSaving,
  onSave,
  onDiscard,
}: SQLStatusBarProps) {
  const hasChanges = changeCount !== undefined && changeCount > 0

  return (
    <div
      className={cn(
        'flex items-center gap-0 h-7 px-2 text-2xs font-medium border-t',
        'select-none shrink-0 overflow-hidden',
        hasChanges
          ? 'border-amber-500/40 bg-amber-500/5'
          : isProduction
            ? 'border-nd-error/40 bg-nd-error/5'
            : 'border-nd-border bg-nd-bg-secondary'
      )}
    >
      {/* Production badge */}
      {isProduction && (
        <StatusItem className="text-nd-error">
          <AlertTriangle size={11} />
          <Badge variant="error" className="text-[10px] py-0 px-1.5 leading-tight">
            PRODUCTION
          </Badge>
        </StatusItem>
      )}

      {/* DB type */}
      {dbType && (
        <StatusItem className="text-nd-text-muted">{dbType}</StatusItem>
      )}

      {/* Database */}
      {database && (
        <StatusItem className="text-nd-text-secondary font-semibold">
          {database}
        </StatusItem>
      )}

      {/* Table */}
      {table && (
        <StatusItem className="text-nd-text-secondary">{table}</StatusItem>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Row info */}
      {rowInfo && (
        <StatusItem className="text-nd-text-muted">{rowInfo}</StatusItem>
      )}

      {/* Execution time */}
      {executionTime !== undefined && (
        <StatusItem className="text-nd-text-muted">{executionTime}ms</StatusItem>
      )}

      {/* Filter count */}
      {filterCount !== undefined && filterCount > 0 && (
        <StatusItem className="text-nd-info">
          <Filter size={11} />
          {filterCount} {filterCount === 1 ? 'Filter' : 'Filters'}
        </StatusItem>
      )}

      {/* Changes: count + save/discard actions */}
      {hasChanges && (
        <>
          <StatusItem className="text-amber-400">
            <GitCommitHorizontal size={11} />
            {changeCount} {changeCount === 1 ? 'change' : 'changes'}
          </StatusItem>
          <div className="w-px h-3 bg-nd-border mx-1.5" />
          <button
            onClick={onDiscard}
            disabled={isSaving}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors disabled:opacity-40"
          >
            <Undo2 size={10} />
            Discard
          </button>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
          >
            {isSaving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
            Save
          </button>
          <span className="text-[9px] text-nd-text-muted ml-1">Ctrl+S</span>
        </>
      )}
    </div>
  )
})

// ── Status item with separator ──

function StatusItem({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <>
      <div className="w-px h-3 bg-nd-border mx-2 first:hidden" />
      <span className={cn('flex items-center gap-1 whitespace-nowrap', className)}>
        {children}
      </span>
    </>
  )
}
