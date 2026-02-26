import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, X, XCircle } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Tooltip } from '@/components/ui/Tooltip'
import type { RunningQuery } from '@/types/sql'

// ── Props ──

interface QueryMonitorProps {
  runningQueries: RunningQuery[]
  onCancelQuery: (queryId: string) => void
  onCancelAll: () => void
}

// ── Helpers ──

/** Format elapsed milliseconds into a compact human-readable string (e.g. "2s", "1m 30s") */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

/** Truncate SQL text to a maximum length, appending ellipsis if needed */
function truncateSQL(sql: string, maxLength = 60): string {
  const trimmed = sql.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= maxLength) return trimmed
  return trimmed.slice(0, maxLength) + '…'
}

// ── Elapsed time hook ──

/** Tick every second to force re-render for elapsed time display */
function useSecondTick(enabled: boolean): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [enabled])

  return tick
}

// ── Component ──

export function QueryMonitor({
  runningQueries,
  onCancelQuery,
  onCancelAll,
}: QueryMonitorProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const count = runningQueries.length

  // Tick every second while there are running queries so elapsed times update
  useSecondTick(count > 0)

  // Auto-close the popover when all queries complete
  useEffect(() => {
    if (count === 0) setOpen(false)
  }, [count])

  // Click-outside handler to close the dropdown
  useEffect(() => {
    if (!open) return

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    // Defer listener to avoid closing from the click that opened it
    const frameId = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside)
    })

    return () => {
      cancelAnimationFrame(frameId)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const toggleOpen = useCallback(() => setOpen((prev) => !prev), [])

  const handleCancel = useCallback(
    (queryId: string) => {
      onCancelQuery(queryId)
    },
    [onCancelQuery]
  )

  const now = Date.now()

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button — always visible; pulsing icon when queries are running */}
      <Tooltip content={count > 0 ? `${count} running ${count === 1 ? 'query' : 'queries'}` : 'No running queries'} side="bottom">
        <button
          onClick={count > 0 ? toggleOpen : undefined}
          aria-disabled={count === 0}
          tabIndex={count === 0 ? -1 : 0}
          className={cn(
            'flex items-center gap-1.5 h-8 px-2 rounded text-xs font-medium transition-colors',
            count > 0
              ? 'text-nd-text-secondary hover:text-nd-text-primary hover:bg-nd-surface cursor-pointer'
              : 'text-nd-text-muted cursor-default',
            open && 'bg-nd-surface text-nd-text-primary'
          )}
        >
          <Activity size={14} className={cn(count > 0 ? 'text-nd-accent animate-pulse' : 'text-nd-text-muted')} />
          <span className="tabular-nums">{count}</span>
        </button>
      </Tooltip>

      {/* Dropdown popover — right-aligned below the button */}
      {open && (
        <div
          className={cn(
            'absolute top-full right-0 mt-1 z-50',
            'w-80 rounded-md border border-nd-border bg-nd-bg-primary shadow-lg',
            'animate-fade-in'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-nd-border">
            <span className="text-xs font-semibold text-nd-text-primary">
              Running Queries
            </span>
            <span className="text-2xs text-nd-text-muted tabular-nums">
              {count} active
            </span>
          </div>

          {/* Query list */}
          <div className="max-h-60 overflow-y-auto">
            {runningQueries.map((q) => {
              const elapsed = now - q.startedAt

              return (
                <div
                  key={q.queryId}
                  className="flex items-start gap-2 px-3 py-2 border-b border-nd-border last:border-b-0 group hover:bg-nd-surface/50 transition-colors"
                >
                  {/* Query info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-nd-text-primary font-mono truncate">
                      {truncateSQL(q.query)}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-2xs text-nd-text-muted tabular-nums">
                        {formatElapsed(elapsed)}
                      </span>
                      {q.table && (
                        <>
                          <span className="text-2xs text-nd-text-muted">·</span>
                          <span className="text-2xs text-nd-text-muted truncate">
                            {q.table}
                          </span>
                        </>
                      )}
                      <span className="text-2xs text-nd-text-muted">·</span>
                      <span className="text-2xs text-nd-text-muted">{q.source}</span>
                    </div>
                  </div>

                  {/* Kill button */}
                  <Tooltip content="Kill query" side="left">
                    <button
                      onClick={() => handleCancel(q.queryId)}
                      className={cn(
                        'shrink-0 p-1 rounded transition-colors',
                        'text-nd-text-muted hover:text-nd-error hover:bg-nd-error/10'
                      )}
                    >
                      <X size={14} />
                    </button>
                  </Tooltip>
                </div>
              )
            })}
          </div>

          {/* Cancel All footer — only shown when 2+ queries are running */}
          {count >= 2 && (
            <div className="px-3 py-2 border-t border-nd-border">
              <button
                onClick={onCancelAll}
                className={cn(
                  'flex items-center justify-center gap-1.5 w-full',
                  'h-7 rounded text-xs font-medium transition-colors',
                  'text-nd-error hover:bg-nd-error/10'
                )}
              >
                <XCircle size={13} />
                Cancel All
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
