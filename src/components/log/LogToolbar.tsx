import { useCallback } from 'react'
import {
  Info,
  AlertTriangle,
  XCircle,
  CheckCircle,
  Search,
  Trash2,
  Download,
  Terminal,
  HardDrive,
  Wifi,
  ArrowLeftRight
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { useLogStore } from '@/stores/logStore'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { toast } from '@/components/ui/Toast'
import type { LogLevel, LogSource } from '@/types/log'

interface LogToolbarProps {
  sessionId: string
}

/** Level filter buttons */
const levelButtons: { level: LogLevel; icon: typeof Info; label: string; activeColor: string }[] = [
  { level: 'info', icon: Info, label: 'Info', activeColor: 'bg-nd-info/20 text-nd-info border-nd-info/40' },
  { level: 'warning', icon: AlertTriangle, label: 'Warning', activeColor: 'bg-nd-warning/20 text-nd-warning border-nd-warning/40' },
  { level: 'error', icon: XCircle, label: 'Error', activeColor: 'bg-nd-error/20 text-nd-error border-nd-error/40' },
  { level: 'success', icon: CheckCircle, label: 'Success', activeColor: 'bg-nd-success/20 text-nd-success border-nd-success/40' }
]

/** Source filter buttons */
const sourceButtons: { source: LogSource; icon: typeof Terminal; label: string }[] = [
  { source: 'ssh', icon: Wifi, label: 'SSH' },
  { source: 'sftp', icon: HardDrive, label: 'SFTP' },
  { source: 'terminal', icon: Terminal, label: 'Terminal' },
  { source: 'portforward', icon: ArrowLeftRight, label: 'Port Fwd' }
]

export function LogToolbar({ sessionId }: LogToolbarProps) {
  const { filters, toggleLevel, toggleSource, setSearchQuery, clearEntries } = useLogStore()

  const handleClear = useCallback(() => {
    clearEntries(sessionId)
    toast.info('Log cleared', 'Activity log entries have been cleared.')
  }, [sessionId, clearEntries])

  const handleExport = useCallback(async () => {
    try {
      await window.novadeck.log.export(sessionId)
      toast.success('Log exported', 'Activity log saved to file.')
    } catch {
      toast.error('Export failed', 'Could not export the activity log.')
    }
  }, [sessionId])

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nd-border bg-nd-bg-secondary shrink-0">
      {/* Level filters */}
      <div className="flex items-center gap-0.5">
        {levelButtons.map(({ level, icon: Icon, label, activeColor }) => {
          const isActive = filters.levels.has(level)
          return (
            <Tooltip key={level} content={`Toggle ${label}`} side="bottom">
              <button
                onClick={() => toggleLevel(level)}
                className={cn(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium border transition-colors',
                  isActive
                    ? activeColor
                    : 'border-transparent text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
                )}
              >
                <Icon size={11} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            </Tooltip>
          )
        })}
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-nd-border" />

      {/* Source filters */}
      <div className="flex items-center gap-0.5">
        {sourceButtons.map(({ source, icon: Icon, label }) => {
          const isActive = filters.sources.has(source)
          return (
            <Tooltip key={source} content={`Toggle ${label}`} side="bottom">
              <button
                onClick={() => toggleSource(source)}
                className={cn(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium border transition-colors',
                  isActive
                    ? 'border-nd-accent/40 bg-nd-accent/10 text-nd-accent'
                    : 'border-transparent text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
                )}
              >
                <Icon size={11} />
                <span className="hidden lg:inline">{label}</span>
              </button>
            </Tooltip>
          )
        })}
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-nd-border" />

      {/* Search */}
      <div className="relative flex-1 max-w-[200px]">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-nd-text-muted" />
        <input
          type="text"
          placeholder="Filter log..."
          value={filters.searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={cn(
            'h-6 w-full rounded border bg-nd-surface pl-7 pr-2 text-2xs text-nd-text-primary',
            'border-nd-border placeholder:text-nd-text-muted',
            'focus:outline-none focus:border-nd-accent focus:ring-1 focus:ring-nd-accent',
            'transition-colors'
          )}
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-0.5">
        <Tooltip content="Export log" side="bottom">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleExport}>
            <Download size={12} />
          </Button>
        </Tooltip>
        <Tooltip content="Clear log" side="bottom">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleClear}>
            <Trash2 size={12} />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
