import { useCallback } from 'react'
import { Info, AlertTriangle, XCircle, CheckCircle, Bug } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'
import type { LogEntry as LogEntryType } from '@/types/log'

interface LogEntryProps {
  entry: LogEntryType
  expanded: boolean
  onToggle: () => void
}

/** Format timestamp as HH:MM:SS.mmm */
function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${h}:${m}:${s}.${ms}`
}

/** Icon and color for each log level */
const levelConfig = {
  info: { icon: Info, textColor: 'text-nd-info', bgColor: 'bg-nd-info/10' },
  warning: { icon: AlertTriangle, textColor: 'text-nd-warning', bgColor: 'bg-nd-warning/10' },
  error: { icon: XCircle, textColor: 'text-nd-error', bgColor: 'bg-nd-error/10' },
  success: { icon: CheckCircle, textColor: 'text-nd-success', bgColor: 'bg-nd-success/10' },
  debug: { icon: Bug, textColor: 'text-nd-text-muted', bgColor: 'bg-nd-text-muted/10' }
} as const

/** Format entry for clipboard copy: [TIMESTAMP] [LEVEL] MESSAGE */
function formatForCopy(entry: LogEntryType): string {
  return `[${formatTimestamp(entry.timestamp)}] [${entry.level.toUpperCase()}] ${entry.message}`
}

export function LogEntry({ entry, expanded, onToggle }: LogEntryProps) {
  const config = levelConfig[entry.level]
  const Icon = config.icon

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      navigator.clipboard.writeText(formatForCopy(entry))
    },
    [entry]
  )

  return (
    <div
      className={cn(
        'group border-b border-nd-border/50 transition-colors',
        expanded ? 'bg-nd-surface/30' : 'hover:bg-nd-surface/20',
        entry.details && 'cursor-pointer'
      )}
      onClick={entry.details ? onToggle : undefined}
      onContextMenu={handleContextMenu}
    >
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-1 min-h-[28px]">
        {/* Level icon */}
        <span className={cn('shrink-0', config.textColor)}>
          <Icon size={13} />
        </span>

        {/* Timestamp */}
        <span className="shrink-0 text-2xs text-nd-text-muted tabular-nums font-mono w-[88px]">
          {formatTimestamp(entry.timestamp)}
        </span>

        {/* Message */}
        <span className="flex-1 text-xs text-nd-text-primary truncate">
          {entry.message}
        </span>

        {/* Source badge */}
        <span className="shrink-0 text-2xs text-nd-text-muted uppercase tracking-wider">
          {entry.source}
        </span>
      </div>

      {/* Expandable details */}
      <AnimatePresence>
        {expanded && entry.details && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                'mx-3 mb-2 px-3 py-2 rounded text-xs font-mono whitespace-pre-wrap break-all',
                'border border-nd-border/50',
                config.bgColor,
                'text-nd-text-secondary'
              )}
            >
              {entry.details}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
