import React, { useCallback, useState, useRef, useEffect } from 'react'
import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Columns3,
  X,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import type { PaginationState, QueryField } from '@/types/sql'
import type { ForeignKeyMap } from '@/components/sql/DataGrid'

// ── Props ──

interface PaginationBarProps {
  pagination: PaginationState
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  executionTimeMs?: number
  /** All available fields for column picker */
  fields?: QueryField[]
  /** Names of hidden columns */
  hiddenColumns?: string[]
  /** Foreign key map for showing FK icon */
  foreignKeys?: ForeignKeyMap
  /** Toggle a column's visibility */
  onToggleColumn?: (colId: string, show: boolean) => void
  /** Show all columns */
  onShowAllColumns?: () => void
}

const PAGE_SIZES = [50, 100, 200, 500, 1000]

// ── Component ──

export const PaginationBar = React.memo(function PaginationBar({
  pagination,
  onPageChange,
  onPageSizeChange,
  executionTimeMs,
  fields,
  hiddenColumns = [],
  foreignKeys,
  onToggleColumn,
  onShowAllColumns,
}: PaginationBarProps) {
  const { page, pageSize, totalRows, totalPages } = pagination
  const [pageInput, setPageInput] = useState(String(page))
  const [showColumnPicker, setShowColumnPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Derived range
  const rangeStart = totalRows === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, totalRows)

  const isFirstPage = page <= 1
  const isLastPage = page >= totalPages

  const handlePageInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPageInput(e.target.value)
    },
    []
  )

  const handlePageInputSubmit = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== 'Enter') return
      const num = parseInt(pageInput, 10)
      if (isNaN(num) || num < 1) {
        setPageInput(String(page))
        return
      }
      const clamped = Math.min(Math.max(1, num), totalPages || 1)
      setPageInput(String(clamped))
      onPageChange(clamped)
    },
    [pageInput, page, totalPages, onPageChange]
  )

  // Sync input when page prop changes externally
  React.useEffect(() => {
    setPageInput(String(page))
  }, [page])

  // Close column picker on click outside
  useEffect(() => {
    if (!showColumnPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showColumnPicker])

  // Close column picker when table changes (fields change)
  useEffect(() => {
    setShowColumnPicker(false)
  }, [fields])

  const handlePageSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onPageSizeChange(Number(e.target.value))
    },
    [onPageSizeChange]
  )

  return (
    <div
      className={cn(
        'flex h-7 shrink-0 items-center gap-1 border-t border-nd-border',
        'bg-nd-bg-secondary px-2 text-xs text-nd-text-secondary select-none'
      )}
    >
      {/* Navigation buttons */}
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0"
        disabled={isFirstPage}
        onClick={() => onPageChange(1)}
        title="First page"
      >
        <ChevronsLeft size={14} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0"
        disabled={isFirstPage}
        onClick={() => onPageChange(page - 1)}
        title="Previous page"
      >
        <ChevronLeft size={14} />
      </Button>

      {/* Page input */}
      <span className="ml-1">Page</span>
      <input
        type="text"
        value={pageInput}
        onChange={handlePageInputChange}
        onKeyDown={handlePageInputSubmit}
        onBlur={() => setPageInput(String(page))}
        className={cn(
          'mx-0.5 h-5 w-10 rounded border border-nd-border bg-nd-surface',
          'px-1 text-center text-xs text-nd-text-primary',
          'focus:border-nd-accent focus:outline-none focus:ring-1 focus:ring-nd-accent'
        )}
      />
      <span>of {totalPages.toLocaleString()}</span>

      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0"
        disabled={isLastPage}
        onClick={() => onPageChange(page + 1)}
        title="Next page"
      >
        <ChevronRight size={14} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 w-5 p-0"
        disabled={isLastPage}
        onClick={() => onPageChange(totalPages)}
        title="Last page"
      >
        <ChevronsRight size={14} />
      </Button>

      {/* Divider */}
      <div className="mx-1.5 h-3 w-px bg-nd-border" />

      {/* Page size selector */}
      <select
        value={pageSize}
        onChange={handlePageSizeChange}
        className={cn(
          'h-5 rounded border border-nd-border bg-nd-surface',
          'px-1 text-xs text-nd-text-primary',
          'cursor-pointer appearance-none',
          'focus:border-nd-accent focus:outline-none'
        )}
      >
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
      <span>rows/page</span>

      {/* Divider */}
      <div className="mx-1.5 h-3 w-px bg-nd-border" />

      {/* Row range info */}
      <span className="text-nd-text-muted">
        Showing {rangeStart.toLocaleString()}-{rangeEnd.toLocaleString()} of ~
        {totalRows.toLocaleString()} rows
      </span>

      {/* Execution time */}
      {executionTimeMs !== undefined && (
        <>
          <div className="mx-1.5 h-3 w-px bg-nd-border" />
          <span className="text-nd-text-muted">{executionTimeMs}ms</span>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Columns button + hidden count */}
      {fields && fields.length > 0 && (
        <div ref={pickerRef} className="relative flex items-center gap-1">
          {hiddenColumns.length > 0 && (
            <>
              <span className="text-2xs text-nd-warning">{hiddenColumns.length} hidden</span>
              <button
                onClick={onShowAllColumns}
                className="text-2xs text-nd-accent hover:text-nd-accent/80 transition-colors"
              >
                Show all
              </button>
              <div className="mx-1 h-3 w-px bg-nd-border" />
            </>
          )}
          <button
            onClick={() => setShowColumnPicker((v) => !v)}
            className={cn(
              'flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium transition-colors',
              showColumnPicker
                ? 'text-nd-accent bg-nd-accent/10'
                : 'text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface'
            )}
          >
            <Columns3 size={11} />
            Columns
          </button>

          {/* Column picker popover */}
          {showColumnPicker && (
            <div
              className="absolute bottom-7 right-0 z-20 w-56 max-h-64 overflow-y-auto rounded-md border border-nd-border bg-nd-bg-primary py-1 shadow-lg"
            >
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-nd-border">
                <span className="text-xs font-medium text-nd-text-secondary">Columns</span>
                <button
                  onClick={() => setShowColumnPicker(false)}
                  className="p-0.5 rounded text-nd-text-muted hover:text-nd-text-primary transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
              {fields.map((field) => {
                const isHidden = hiddenColumns.includes(field.name)
                return (
                  <label
                    key={field.name}
                    className="flex items-center gap-2 px-3 py-1 text-xs text-nd-text-secondary hover:bg-nd-surface-hover cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={!isHidden}
                      onChange={() => onToggleColumn?.(field.name, isHidden)}
                      className="accent-nd-accent w-3 h-3"
                    />
                    <span className="truncate">{field.name}</span>
                    {foreignKeys?.[field.name] && (
                      <ExternalLink size={10} className="shrink-0 text-nd-text-muted" />
                    )}
                  </label>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
})
