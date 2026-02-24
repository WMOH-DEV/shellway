import { useMemo, useCallback, useState } from 'react'
import {
  ArrowUpDown, ArrowUp, ArrowDown,
  Play, Square, RotateCw, Inbox
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Tooltip } from '@/components/ui/Tooltip'
import type { SystemdService, ServiceAction } from '@/types/serviceManager'

interface ServiceListProps {
  connectionId: string
  services: SystemdService[]
  selectedUnit: string | null
  onSelectUnit: (unit: string) => void
  onAction: (unit: string, action: ServiceAction) => void
  isLoading: boolean
}

type SortKey = 'name' | 'active' | 'sub' | 'description'

/** Get dot color based on active+sub state */
function getServiceDotColor(active: string, sub: string): string {
  if (active === 'failed' || sub === 'failed') return 'bg-red-400'
  if (active === 'activating' || active === 'deactivating') return 'bg-amber-400'
  if (active === 'active' && sub === 'running') return 'bg-emerald-400'
  if (active === 'active') return 'bg-emerald-400/70'
  return 'bg-nd-text-muted'
}

/** Get text color for sub-state */
function getSubStateColor(sub: string): string {
  switch (sub) {
    case 'running': return 'text-emerald-400'
    case 'failed': return 'text-red-400'
    case 'dead': case 'inactive': return 'text-nd-text-muted'
    case 'waiting': case 'listening': return 'text-blue-400'
    case 'exited': return 'text-nd-text-muted'
    default: return 'text-nd-text-secondary'
  }
}

export function ServiceList({
  services,
  selectedUnit,
  onSelectUnit,
  onAction,
  isLoading
}: ServiceListProps) {
  const [sortBy, setSortBy] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = useCallback((column: SortKey) => {
    if (sortBy === column) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortDir('asc')
    }
  }, [sortBy])

  const sortedServices = useMemo(() => {
    return [...services].sort((a, b) => {
      let aVal: string
      let bVal: string

      switch (sortBy) {
        case 'name': aVal = a.unit; bVal = b.unit; break
        case 'active': aVal = a.active; bVal = b.active; break
        case 'sub': aVal = a.sub; bVal = b.sub; break
        case 'description': aVal = a.description; bVal = b.description; break
      }

      const cmp = aVal.localeCompare(bVal)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [services, sortBy, sortDir])

  const handleRowKeyDown = useCallback((e: React.KeyboardEvent, unit: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelectUnit(unit)
    }
  }, [onSelectUnit])

  if (isLoading && services.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center space-y-2">
          <div className="w-5 h-5 border-2 border-nd-accent border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-nd-text-muted">Loading services...</p>
        </div>
      </div>
    )
  }

  if (services.length === 0) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center space-y-2">
          <Inbox size={32} className="mx-auto text-nd-text-muted opacity-30" />
          <p className="text-sm text-nd-text-muted">No services match the current filters</p>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-nd-text-muted uppercase tracking-wider border-b border-nd-border/30">
            <th className="py-1.5 px-2 text-left w-6">
              <span className="sr-only">Status</span>
            </th>
            <SortableHeader
              column="name"
              label="Name"
              current={sortBy}
              direction={sortDir}
              onSort={handleSort}
              className="text-left"
            />
            <SortableHeader
              column="sub"
              label="State"
              current={sortBy}
              direction={sortDir}
              onSort={handleSort}
              className="text-left w-24"
            />
            <SortableHeader
              column="description"
              label="Description"
              current={sortBy}
              direction={sortDir}
              onSort={handleSort}
              className="text-left"
            />
            <th className="py-1.5 px-2 w-24">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedServices.map(svc => {
            const isSelected = svc.unit === selectedUnit
            const isRunning = svc.active === 'active' && (svc.sub === 'running' || svc.sub === 'exited' || svc.sub === 'waiting' || svc.sub === 'listening')
            const isStopped = svc.active === 'inactive' || svc.sub === 'dead'

            return (
              <tr
                key={svc.unit}
                tabIndex={0}
                role="button"
                onClick={() => onSelectUnit(svc.unit)}
                onKeyDown={e => handleRowKeyDown(e, svc.unit)}
                className={cn(
                  'group border-b border-nd-border/10 transition-colors cursor-pointer',
                  'hover:bg-nd-surface/50 focus-visible:outline-none focus-visible:bg-nd-surface/50',
                  isSelected ? 'bg-nd-accent/10' : 'even:bg-nd-surface/30'
                )}
              >
                {/* Status dot */}
                <td className="py-1.5 px-2">
                  <span className={cn('inline-block w-2 h-2 rounded-full shrink-0', getServiceDotColor(svc.active, svc.sub))} />
                </td>

                {/* Unit name */}
                <td className="py-1.5 px-2 font-mono text-nd-text-secondary truncate max-w-[260px]" title={svc.unit}>
                  {svc.unit}
                </td>

                {/* Sub-state */}
                <td className={cn('py-1.5 px-2 tabular-nums', getSubStateColor(svc.sub))}>
                  {svc.sub}
                </td>

                {/* Description */}
                <td className="py-1.5 px-2 text-nd-text-muted truncate max-w-[300px]" title={svc.description}>
                  {svc.description}
                </td>

                {/* Quick actions */}
                <td className="py-1 px-2" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    {isRunning && (
                      <>
                        <Tooltip content="Restart" side="top">
                          <button
                            onClick={() => onAction(svc.unit, 'restart')}
                            className="p-1 rounded text-nd-text-muted hover:text-orange-400 hover:bg-orange-400/10 transition-colors"
                          >
                            <RotateCw size={12} />
                          </button>
                        </Tooltip>
                        <Tooltip content="Stop" side="top">
                          <button
                            onClick={() => onAction(svc.unit, 'stop')}
                            className="p-1 rounded text-nd-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                          >
                            <Square size={12} />
                          </button>
                        </Tooltip>
                      </>
                    )}
                    {(isStopped || svc.active === 'failed') && (
                      <Tooltip content="Start" side="top">
                        <button
                          onClick={() => onAction(svc.unit, 'start')}
                          className="p-1 rounded text-nd-text-muted hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors"
                        >
                          <Play size={12} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Sortable Table Header ──

function SortableHeader({
  column,
  label,
  current,
  direction,
  onSort,
  className
}: {
  column: SortKey
  label: string
  current: SortKey
  direction: 'asc' | 'desc'
  onSort: (col: SortKey) => void
  className?: string
}) {
  const isActive = column === current
  return (
    <th
      className={cn(
        'py-1.5 px-2 cursor-pointer select-none transition-colors hover:text-nd-text-secondary',
        isActive && 'text-nd-text-secondary',
        className
      )}
      onClick={() => onSort(column)}
    >
      <span className={cn('inline-flex items-center gap-1', className?.includes('text-right') && 'justify-end w-full')}>
        {label}
        {isActive
          ? direction === 'asc'
            ? <ArrowUp size={10} className="text-nd-accent" />
            : <ArrowDown size={10} className="text-nd-accent" />
          : <ArrowUpDown size={10} className="opacity-25" />
        }
      </span>
    </th>
  )
}
