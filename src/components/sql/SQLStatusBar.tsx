import { memo } from 'react'
import { AlertTriangle, Filter, GitCommitHorizontal } from 'lucide-react'
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
}: SQLStatusBarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-0 h-7 px-2 text-2xs font-medium border-t',
        'select-none shrink-0 overflow-hidden',
        isProduction
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

      {/* Change count */}
      {changeCount !== undefined && changeCount > 0 && (
        <StatusItem className="text-nd-warning">
          <GitCommitHorizontal size={11} />
          {changeCount} {changeCount === 1 ? 'change' : 'changes'}
        </StatusItem>
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
