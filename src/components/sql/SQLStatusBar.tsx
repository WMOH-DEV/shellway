import { memo, useState, useRef, useEffect, useCallback } from 'react'
import { AlertTriangle, Filter, GitCommitHorizontal, Save, Undo2, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Badge } from '@/components/ui/Badge'
import type { StagedChange } from '@/types/sql'

// ── Helpers ──

/** Format a cell value for display in the review popover */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (value === '') return '(empty)'
  if (typeof value === 'string' && value.startsWith('__SQL_EXPR__:')) {
    return value.slice('__SQL_EXPR__:'.length)
  }
  if (typeof value === 'object') return JSON.stringify(value)
  const str = String(value)
  return str.length > 60 ? str.slice(0, 57) + '…' : str
}

// ── Props ──

interface SQLStatusBarProps {
  dbType?: string
  database?: string
  table?: string
  rowInfo?: string
  executionTime?: number
  filterCount?: number
  changeCount?: number
  /** The actual staged changes — passed for the review popover */
  changes?: StagedChange[]
  isProduction?: boolean
  isSaving?: boolean
  onSave?: () => void
  onDiscard?: () => void
  /** Undo a single change by its ID */
  onUndoChange?: (changeId: string) => void
}

// ── Changes Review Popover ──

const ChangesReviewPopover = memo(function ChangesReviewPopover({
  changes,
  onUndoChange,
  onClose,
}: {
  changes: StagedChange[]
  onUndoChange?: (changeId: string) => void
  onClose: () => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Group changes for cleaner display
  const updates = changes.filter((c) => c.type === 'update')
  const inserts = changes.filter((c) => c.type === 'insert')
  const deletes = changes.filter((c) => c.type === 'delete')

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-8 right-0 z-30 w-[420px] max-h-[360px] rounded-lg border border-nd-border bg-nd-bg-primary shadow-xl flex flex-col overflow-hidden animate-fade-in"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-nd-border shrink-0">
        <span className="text-xs font-semibold text-nd-text-primary">
          Pending Changes ({changes.length})
        </span>
        <button
          onClick={onClose}
          className="p-0.5 rounded text-nd-text-muted hover:text-nd-text-primary transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Changes list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Updates */}
        {updates.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-500/5">
              <Pencil size={10} className="inline mr-1 -mt-px" />
              Updates ({updates.length})
            </div>
            {updates.map((change) => (
              <div
                key={change.id}
                className="group flex items-start gap-2 px-3 py-1.5 border-b border-nd-border/50 hover:bg-nd-surface-hover transition-colors"
              >
                <div className="flex-1 min-w-0 text-xs">
                  {/* Show which column was updated */}
                  {change.column && (
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="font-mono text-nd-text-muted text-[10px]">
                        {change.table}.{change.column}
                      </span>
                      {change.primaryKey && (
                        <span className="text-[9px] text-nd-text-muted/60">
                          PK: {Object.values(change.primaryKey).join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <span className="text-nd-error/80 line-through truncate max-w-[140px]" title={String(change.oldValue ?? '')}>
                      {formatValue(change.oldValue)}
                    </span>
                    <span className="text-nd-text-muted text-[10px]">→</span>
                    <span className="text-nd-success truncate max-w-[140px]" title={String(change.newValue ?? '')}>
                      {formatValue(change.newValue)}
                    </span>
                  </div>
                </div>
                {onUndoChange && (
                  <button
                    onClick={() => onUndoChange(change.id)}
                    className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded text-nd-text-muted hover:text-nd-error hover:bg-nd-error/10 transition-all"
                    title="Undo this change"
                  >
                    <Undo2 size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Inserts */}
        {inserts.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-nd-success bg-nd-success/5">
              <Plus size={10} className="inline mr-1 -mt-px" />
              Inserts ({inserts.length})
            </div>
            {inserts.map((change) => {
              const row = change.newRow ?? {}
              const entries = Object.entries(row).filter(
                ([k]) => k !== '__rowIndex'
              )
              const preview = entries.slice(0, 4)
              const remaining = entries.length - preview.length
              return (
                <div
                  key={change.id}
                  className="group flex items-start gap-2 px-3 py-1.5 border-b border-nd-border/50 hover:bg-nd-surface-hover transition-colors"
                >
                  <div className="flex-1 min-w-0 text-xs">
                    <span className="font-mono text-nd-text-muted text-[10px]">{change.table}</span>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                      {preview.map(([col, val]) => (
                        <span key={col} className="text-nd-text-secondary">
                          <span className="text-nd-text-muted">{col}:</span>{' '}
                          <span className="text-nd-success">{formatValue(val)}</span>
                        </span>
                      ))}
                      {remaining > 0 && (
                        <span className="text-nd-text-muted">+{remaining} more</span>
                      )}
                    </div>
                  </div>
                  {onUndoChange && (
                    <button
                      onClick={() => onUndoChange(change.id)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded text-nd-text-muted hover:text-nd-error hover:bg-nd-error/10 transition-all"
                      title="Undo this insert"
                    >
                      <Undo2 size={11} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Deletes */}
        {deletes.length > 0 && (
          <div>
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-nd-error bg-nd-error/5">
              <Trash2 size={10} className="inline mr-1 -mt-px" />
              Deletes ({deletes.length})
            </div>
            {deletes.map((change) => {
              const pk = change.primaryKey
              return (
                <div
                  key={change.id}
                  className="group flex items-center gap-2 px-3 py-1.5 border-b border-nd-border/50 hover:bg-nd-surface-hover transition-colors"
                >
                  <div className="flex-1 min-w-0 text-xs">
                    <span className="font-mono text-nd-text-muted text-[10px]">{change.table}</span>
                    {pk && (
                      <span className="ml-1.5 text-nd-error/80">
                        {Object.entries(pk).map(([k, v]) => `${k}=${v}`).join(', ')}
                      </span>
                    )}
                  </div>
                  {onUndoChange && (
                    <button
                      onClick={() => onUndoChange(change.id)}
                      className="opacity-0 group-hover:opacity-100 shrink-0 p-1 rounded text-nd-text-muted hover:text-nd-error hover:bg-nd-error/10 transition-all"
                      title="Undo this delete"
                    >
                      <Undo2 size={11} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
})

// ── Main Status Bar ──

export const SQLStatusBar = memo(function SQLStatusBar({
  dbType,
  database,
  table,
  rowInfo,
  executionTime,
  filterCount,
  changeCount,
  changes,
  isProduction,
  isSaving,
  onSave,
  onDiscard,
  onUndoChange,
}: SQLStatusBarProps) {
  const hasChanges = changeCount !== undefined && changeCount > 0
  const [showReview, setShowReview] = useState(false)

  // Close review when changes are cleared (after save/discard)
  useEffect(() => {
    if (!hasChanges) setShowReview(false)
  }, [hasChanges])

  const handleToggleReview = useCallback(() => {
    setShowReview((v) => !v)
  }, [])

  const handleCloseReview = useCallback(() => {
    setShowReview(false)
  }, [])

  return (
    <div
      className={cn(
        'flex items-center gap-0 h-7 px-2 text-2xs font-medium border-t',
        'select-none shrink-0 overflow-hidden relative',
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

      {/* Changes: count (clickable) + save/discard actions */}
      {hasChanges && (
        <>
          <div className="w-px h-3 bg-nd-border mx-2" />
          <button
            onClick={handleToggleReview}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs transition-colors',
              showReview
                ? 'text-amber-300 bg-amber-500/15'
                : 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
            )}
            title="Review pending changes"
          >
            <GitCommitHorizontal size={11} />
            {changeCount} {changeCount === 1 ? 'change' : 'changes'}
          </button>
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

          {/* Review popover */}
          {showReview && changes && changes.length > 0 && (
            <ChangesReviewPopover
              changes={changes}
              onUndoChange={onUndoChange}
              onClose={handleCloseReview}
            />
          )}
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
