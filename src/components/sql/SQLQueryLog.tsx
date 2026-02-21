import React, { useCallback, useEffect, useRef } from 'react'
import { AlertCircle, Copy, Clock } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useSQLConnection } from '@/stores/sqlStore'
import type { QueryHistoryEntry } from '@/types/sql'

// ── Relative time formatting ──

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

// ── Log entry ──

const LogEntry = React.memo(function LogEntry({ entry }: { entry: QueryHistoryEntry }) {
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(entry.query)
  }, [entry.query])

  return (
    <div
      className={cn(
        'group flex items-start gap-2 px-2 py-1 text-2xs font-mono border-b border-nd-border/50 hover:bg-nd-surface/50 transition-colors',
        entry.error && 'bg-red-500/5'
      )}
    >
      {/* Timestamp */}
      <span className="shrink-0 text-nd-text-muted/60 tabular-nums w-[52px] pt-px">
        {new Date(entry.executedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>

      {/* Query text */}
      <pre className={cn(
        'flex-1 whitespace-pre-wrap break-all leading-relaxed line-clamp-2 min-w-0',
        entry.error ? 'text-red-400' : 'text-nd-text-primary'
      )}>
        {entry.query}
      </pre>

      {/* Meta */}
      <div className="shrink-0 flex items-center gap-1.5 pt-px">
        {entry.error ? (
          <span className="flex items-center gap-0.5 text-red-400" title={entry.error}>
            <AlertCircle size={9} />
            ERR
          </span>
        ) : (
          <>
            {entry.rowCount !== undefined && (
              <span className="text-nd-text-muted">{entry.rowCount}r</span>
            )}
            <span className="text-nd-text-muted tabular-nums">{Math.round(entry.executionTimeMs)}ms</span>
          </>
        )}

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="p-0.5 rounded text-nd-text-muted/30 hover:text-nd-text-primary opacity-0 group-hover:opacity-100 transition-opacity"
          title="Copy query"
        >
          <Copy size={10} />
        </button>
      </div>
    </div>
  )
})

// ── Component ──

interface SQLQueryLogProps {
  connectionId: string
}

export function SQLQueryLog({ connectionId }: SQLQueryLogProps) {
  const { history } = useSQLConnection(connectionId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const wasAtBottomRef = useRef(true)

  // Auto-scroll to bottom when new entries arrive (if already at bottom)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [history.length])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    wasAtBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 20
  }, [])

  // Show newest at bottom (chronological)
  const sorted = history.slice().sort((a, b) => a.executedAt - b.executedAt)

  return (
    <div className="h-full flex flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-0"
      >
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full text-nd-text-muted text-xs">
            No queries executed yet
          </div>
        ) : (
          sorted.map((entry) => (
            <LogEntry key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  )
}
