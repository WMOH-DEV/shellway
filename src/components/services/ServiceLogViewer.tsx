import { useState, useRef, useEffect, useCallback } from 'react'
import { RefreshCw, ArrowDownToLine, Copy, Check, X, FileText } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import type { ServiceLogEntry } from '@/types/serviceManager'

interface ServiceLogViewerProps {
  connectionId: string
  unit: string
  logs: ServiceLogEntry[]
  isLoading: boolean
  onLoadLogs: (lines: number) => void
  onClose: () => void
}

const LINE_COUNT_OPTIONS = [
  { value: '50', label: '50 lines' },
  { value: '100', label: '100 lines' },
  { value: '500', label: '500 lines' },
  { value: '1000', label: '1000 lines' },
]

const PRIORITY_BADGE: Record<string, string> = {
  emerg: 'EMERG',
  alert: 'ALERT',
  crit: 'CRIT',
  err: 'ERR',
  warning: 'WARN',
  notice: 'NOTE',
  info: 'INFO',
  debug: 'DEBUG',
}

/** Threshold in px — if user scrolls up beyond this, disable follow */
const SCROLL_THRESHOLD = 40

export function ServiceLogViewer({
  connectionId: _connectionId,
  unit,
  logs,
  isLoading,
  onLoadLogs,
  onClose,
}: ServiceLogViewerProps) {
  const [lineCount, setLineCount] = useState(100)
  const [follow, setFollow] = useState(true)
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledRef = useRef(false)

  // Auto-scroll to bottom when follow is enabled and logs change
  useEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, follow])

  // Detect manual scroll-up to disable follow
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD

    if (!isAtBottom && !userScrolledRef.current) {
      userScrolledRef.current = true
      setFollow(false)
    } else if (isAtBottom && userScrolledRef.current) {
      userScrolledRef.current = false
    }
  }, [])

  const handleLineCountChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const count = Number(e.target.value)
      setLineCount(count)
      onLoadLogs(count)
    },
    [onLoadLogs]
  )

  const handleRefresh = useCallback(() => {
    onLoadLogs(lineCount)
  }, [onLoadLogs, lineCount])

  const handleToggleFollow = useCallback(() => {
    setFollow((prev) => {
      const next = !prev
      if (next && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
      userScrolledRef.current = false
      return next
    })
  }, [])

  const handleCopy = useCallback(() => {
    const text = logs
      .map((entry) => {
        const ts = formatTimestamp(entry.timestamp)
        const badge = PRIORITY_BADGE[entry.priority] || entry.priority.toUpperCase()
        return `[${ts}] [${badge}] ${entry.message}`
      })
      .join('\n')

    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
        toast.success('Copied', `${logs.length} log lines copied to clipboard`)
      })
      .catch(() => toast.error('Copy failed', 'Unable to write to clipboard'))
  }, [logs])

  return (
    <div className="bg-nd-bg-primary rounded-lg border border-nd-border flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-nd-bg-secondary border-b border-nd-border flex items-center gap-2 shrink-0">
        <FileText size={14} className="text-nd-text-muted shrink-0" />
        <span className="text-xs font-semibold text-nd-text-secondary truncate">{unit}</span>

        <div className="flex-1" />

        {/* Line count selector */}
        <select
          value={String(lineCount)}
          onChange={handleLineCountChange}
          className={cn(
            'h-6 rounded border bg-nd-surface px-1.5 text-[11px] text-nd-text-primary',
            'border-nd-border appearance-none cursor-pointer',
            'hover:border-nd-border-hover',
            'focus:outline-none focus:border-nd-accent'
          )}
        >
          {LINE_COUNT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading}
          className="h-6 px-1.5"
          title="Refresh logs"
        >
          <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
        </Button>

        {/* Follow toggle */}
        <Button
          variant={follow ? 'primary' : 'ghost'}
          size="sm"
          onClick={handleToggleFollow}
          className="h-6 px-2 gap-1"
          title={follow ? 'Disable auto-scroll' : 'Enable auto-scroll'}
        >
          <ArrowDownToLine size={12} />
          <span className="text-[11px]">Follow</span>
        </Button>

        {/* Copy */}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          disabled={logs.length === 0}
          className="h-6 px-1.5"
          title="Copy logs to clipboard"
        >
          {copied ? (
            <Check size={12} className="text-emerald-400" />
          ) : (
            <Copy size={12} />
          )}
        </Button>

        {/* Close */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-6 px-1.5"
          title="Close log viewer"
        >
          <X size={12} />
        </Button>
      </div>

      {/* Log area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto scrollbar-thin font-mono text-xs leading-relaxed"
      >
        {isLoading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-2">
              <RefreshCw size={20} className="mx-auto text-nd-accent animate-spin" />
              <p className="text-xs text-nd-text-muted">Loading logs...</p>
            </div>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-2">
              <FileText size={20} className="mx-auto text-nd-text-muted opacity-30" />
              <p className="text-xs text-nd-text-muted">No logs available</p>
            </div>
          </div>
        ) : (
          logs.map((entry, i) => (
            <LogLine key={i} entry={entry} />
          ))
        )}
      </div>

      {/* Bottom status bar */}
      {logs.length > 0 && (
        <div className="px-3 py-1 bg-nd-bg-secondary border-t border-nd-border flex items-center justify-between text-[10px] text-nd-text-muted shrink-0">
          <span>{logs.length} lines</span>
          {isLoading && (
            <span className="flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin" />
              Refreshing...
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Log Line ──

function LogLine({ entry }: { entry: ServiceLogEntry }) {
  const ts = formatTimestamp(entry.timestamp)
  const badge = PRIORITY_BADGE[entry.priority] || entry.priority.toUpperCase()
  const { textClass, bgClass, badgeClass } = getPriorityStyles(entry.priority)

  return (
    <div
      className={cn(
        'px-3 py-0.5 hover:bg-nd-surface/50 flex items-start gap-2',
        bgClass
      )}
    >
      <span className="text-nd-text-muted shrink-0 select-none tabular-nums">{ts}</span>
      <span
        className={cn(
          'shrink-0 select-none text-[10px] font-semibold w-12 text-center rounded px-1',
          badgeClass
        )}
      >
        [{badge}]
      </span>
      <span className={cn('break-all', textClass)}>{entry.message}</span>
    </div>
  )
}

// ── Helpers ──

function getPriorityStyles(priority: string): {
  textClass: string
  bgClass: string
  badgeClass: string
} {
  switch (priority) {
    case 'emerg':
    case 'alert':
    case 'crit':
      return {
        textClass: 'text-red-400',
        bgClass: 'bg-red-500/10',
        badgeClass: 'text-red-400 bg-red-500/15',
      }
    case 'err':
      return {
        textClass: 'text-red-400',
        bgClass: '',
        badgeClass: 'text-red-400',
      }
    case 'warning':
      return {
        textClass: 'text-yellow-400',
        bgClass: '',
        badgeClass: 'text-yellow-400',
      }
    case 'notice':
      return {
        textClass: 'text-blue-400',
        bgClass: '',
        badgeClass: 'text-blue-400',
      }
    case 'info':
      return {
        textClass: 'text-nd-text-secondary',
        bgClass: '',
        badgeClass: 'text-nd-text-muted',
      }
    case 'debug':
      return {
        textClass: 'text-nd-text-muted',
        bgClass: '',
        badgeClass: 'text-nd-text-muted',
      }
    default:
      return {
        textClass: 'text-nd-text-secondary',
        bgClass: '',
        badgeClass: 'text-nd-text-muted',
      }
  }
}

function formatTimestamp(raw: string): string {
  try {
    const date = new Date(raw)
    if (isNaN(date.getTime())) return raw

    const now = new Date()
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()

    if (isToday) {
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    }

    return date.toLocaleString('en-US', {
      hour12: false,
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return raw
  }
}
