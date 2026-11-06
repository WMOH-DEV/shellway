import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Clock, Loader2, Minus, RotateCcw, Search, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { DeployRecord, SiteSummary } from '@/types/deploy'
import { duration, isInterrupted, shortSha, timeAgo } from '@/utils/deploy/siteStatus'
import { runTone, triggerLabel, type RunTone } from '@/utils/deploy/siteRow'
import { canRollBackTo, isLiveRecord, matchesHistoryFilter, matchesHistorySearch, recordTitle, type HistoryFilter } from '@/utils/deploy/siteDetail'

interface HistoryListProps {
  summary: SiteSummary
  selectedId: string | undefined
  onSelect: (id: string) => void
  onRollback: (record: DeployRecord) => void
}

const FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'warnings', label: 'Warnings' }
]

const TONE_ICON: Record<RunTone, { icon: ReactNode; style: string }> = {
  success: { icon: <Check size={13} />, style: 'bg-nd-success/[.14] text-nd-success' },
  warning: { icon: <AlertTriangle size={13} />, style: 'bg-nd-warning/[.14] text-nd-warning' },
  failed: { icon: <X size={13} />, style: 'bg-nd-error/[.14] text-nd-error' },
  running: { icon: <Loader2 size={13} className="animate-spin" />, style: 'bg-nd-info/[.14] text-nd-info' },
  waiting: { icon: <Clock size={13} />, style: 'bg-nd-warning/[.14] text-nd-warning' },
  cancelled: { icon: <Minus size={13} />, style: 'bg-nd-bg-tertiary text-nd-text-muted' }
}

function noteStyle(tone: RunTone): string {
  if (tone === 'failed') return 'text-nd-error'
  return tone === 'warning' || tone === 'waiting' ? 'text-nd-warning' : 'text-nd-text-muted'
}

function recordNote(record: DeployRecord, interrupted: boolean): string {
  if (interrupted) return 'Stopped before it finished'
  if (record.note) return record.note.charAt(0).toUpperCase() + record.note.slice(1)
  return record.warnings > 0 ? `${record.warnings} optional command${record.warnings > 1 ? 's' : ''} failed` : ''
}

interface ItemProps {
  record: DeployRecord
  summary: SiteSummary
  selected: boolean
  onSelect: () => void
  onRollback: () => void
}

function HistoryItem({ record, summary, selected, onSelect, onRollback }: ItemProps) {
  const { state } = summary
  const tone = runTone(record, summary)
  const note = recordNote(record, isInterrupted(record, summary))
  const icon = record.status === 'reverted' ? { ...TONE_ICON.failed, icon: <RotateCcw size={13} /> } : TONE_ICON[tone]
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      className={cn(
        'group flex cursor-pointer items-start gap-2.5 border-b border-l-2 border-b-nd-border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-nd-accent',
        selected ? 'border-l-nd-accent bg-nd-bg-tertiary' : 'border-l-transparent hover:bg-nd-bg-tertiary/50'
      )}
    >
      <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md', icon.style)}>{icon.icon}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] text-nd-text-primary">{recordTitle(record)}</span>
          {isLiveRecord(summary, record) && <span className="shrink-0 rounded bg-nd-success/[.12] px-1.5 text-[11px] text-nd-success">live</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-nd-text-muted">
          {record.commit && <span className="font-mono">{shortSha(record.commit)}</span>}
          {record.commit && <span>·</span>}
          <span>{triggerLabel(record.trigger)}</span>
          <span>·</span>
          <span className="truncate">{timeAgo(record.started, state.now)}</span>
          <span className="font-mono">{duration(record)}</span>
        </div>
        {note && <span className={cn('truncate text-xs', noteStyle(tone))}>{note}</span>}
      </div>
      {canRollBackTo(summary, record) && (
        <button
          type="button"
          title="Roll back to this deploy"
          aria-label={`Roll back to ${shortSha(record.commit)}`}
          disabled={state.busy}
          onClick={(e) => { e.stopPropagation(); onRollback() }}
          className="shrink-0 rounded p-1 text-nd-text-muted opacity-0 transition-opacity hover:bg-nd-bg-tertiary hover:text-nd-text-primary focus-visible:opacity-100 disabled:hidden group-hover:opacity-100"
        >
          <RotateCcw size={13} />
        </button>
      )}
    </div>
  )
}

export function HistoryList({ summary, selectedId, onSelect, onRollback }: HistoryListProps) {
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const shown = useMemo(
    () => summary.history.filter((r) => matchesHistoryFilter(r, filter, summary) && matchesHistorySearch(r, query)),
    [summary, filter, query]
  )

  return (
    <section aria-label="Deploy history" className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-1 border-b border-nd-border px-3 py-2">
        {searching ? (
          <input
            autoFocus
            aria-label="Search history"
            placeholder="Search history"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setSearching(false) } }}
            className="h-[26px] min-w-0 flex-1 rounded-md border border-nd-border bg-nd-bg-primary px-2 text-xs text-nd-text-primary outline-none focus:border-nd-accent"
          />
        ) : FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn('h-[26px] rounded-md px-2.5 text-xs transition-colors', filter === f.id ? 'bg-nd-bg-tertiary text-nd-text-primary' : 'text-nd-text-muted hover:text-nd-text-primary')}
          >
            {f.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          aria-label={searching ? 'Close search' : 'Search history'}
          onClick={() => { setSearching(!searching); setQuery('') }}
          className="rounded-md p-1.5 text-nd-text-muted hover:bg-nd-bg-tertiary hover:text-nd-text-primary"
        >
          {searching ? <X size={14} /> : <Search size={14} />}
        </button>
      </div>
      <div role="listbox" aria-label="Deploys" className="min-h-0 flex-1 overflow-y-auto">
        {summary.history.length === 0 && <div className="p-4 text-xs text-nd-text-muted">No deploys yet</div>}
        {summary.history.length > 0 && shown.length === 0 && <div className="p-4 text-xs text-nd-text-muted">No deploys match</div>}
        {shown.map((record) => (
          <HistoryItem
            key={record.id}
            record={record}
            summary={summary}
            selected={record.id === selectedId}
            onSelect={() => onSelect(record.id)}
            onRollback={() => onRollback(record)}
          />
        ))}
      </div>
    </section>
  )
}
