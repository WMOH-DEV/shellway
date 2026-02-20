import React, { useCallback, useState } from 'react'
import {
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import type { PaginationState } from '@/types/sql'

// ── Props ──

interface PaginationBarProps {
  pagination: PaginationState
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  executionTimeMs?: number
}

const PAGE_SIZES = [50, 100, 200, 500, 1000]

// ── Component ──

export const PaginationBar = React.memo(function PaginationBar({
  pagination,
  onPageChange,
  onPageSizeChange,
  executionTimeMs,
}: PaginationBarProps) {
  const { page, pageSize, totalRows, totalPages } = pagination
  const [pageInput, setPageInput] = useState(String(page))

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
    </div>
  )
})
