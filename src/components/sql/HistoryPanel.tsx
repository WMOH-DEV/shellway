import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Search,
  Star,
  Trash2,
  X
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import type { HistorySource, PersistedHistoryEntry } from '@/types/sql'

interface HistoryPanelProps {
  scopeId: string
  currentDatabase: string
  refreshToken: number
  onOpenQuery: (sql: string) => void
}

type SourceFilter = HistorySource | 'all'

const SOURCE_TABS: { value: SourceFilter; label: string; title: string }[] = [
  { value: 'user', label: 'Editor', title: 'Queries you ran in a query tab' },
  { value: 'data', label: 'Tables', title: 'Queries the app ran to browse tables' },
  { value: 'all', label: 'All', title: 'Everything' }
]

function dayLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()

  if (sameDay(date, today)) return 'Today'
  if (sameDay(date, yesterday)) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function compact(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim()
  return flat.length > 220 ? `${flat.slice(0, 220)}…` : flat
}

interface DayGroup {
  label: string
  entries: PersistedHistoryEntry[]
}

function groupByDay(entries: PersistedHistoryEntry[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const entry of entries) {
    const label = dayLabel(entry.executedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.entries.push(entry)
    else groups.push({ label, entries: [entry] })
  }
  return groups
}

export function HistoryPanel({
  scopeId,
  currentDatabase,
  refreshToken,
  onOpenQuery
}: HistoryPanelProps) {
  const [entries, setEntries] = useState<PersistedHistoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [source, setSource] = useState<SourceFilter>('user')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [thisDatabaseOnly, setThisDatabaseOnly] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200)
    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(() => {
    if (!scopeId) return
    window.novadeck.sql
      .historyList(scopeId, {
        search: debouncedSearch,
        source,
        favoritesOnly,
        database: thisDatabaseOnly ? currentDatabase : undefined,
        limit: 300
      })
      .then((result: { entries: PersistedHistoryEntry[]; total: number }) => {
        setEntries(result?.entries ?? [])
        setTotal(result?.total ?? 0)
      })
      .catch(() => {
        setEntries([])
        setTotal(0)
      })
  }, [
    scopeId,
    debouncedSearch,
    source,
    favoritesOnly,
    thisDatabaseOnly,
    currentDatabase
  ])

  useEffect(() => {
    load()
  }, [load, refreshToken])

  const groups = useMemo(() => groupByDay(entries), [entries])

  const handleToggleGroup = useCallback((label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  const handleFavorite = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      window.novadeck.sql.historyFavorite(scopeId, id).then(load).catch(() => {})
    },
    [scopeId, load]
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      window.novadeck.sql.historyRemove(scopeId, [id]).then(load).catch(() => {})
    },
    [scopeId, load]
  )

  const handleClear = useCallback(() => {
    if (!window.confirm('Clear history for this connection? Favourites are kept.')) {
      return
    }
    window.novadeck.sql.historyClear(scopeId, true).then(load).catch(() => {})
  }, [scopeId, load])

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 py-2 border-b border-nd-border shrink-0 space-y-2">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-nd-surface border border-nd-border focus-within:border-nd-accent">
          <Search size={12} className="text-nd-text-muted shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history..."
            className="flex-1 min-w-0 bg-transparent text-xs text-nd-text-primary placeholder:text-nd-text-muted outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-nd-text-muted hover:text-nd-text-primary"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {SOURCE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSource(tab.value)}
              title={tab.title}
              className={cn(
                'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                source === tab.value
                  ? 'bg-nd-surface text-nd-text-primary'
                  : 'text-nd-text-muted hover:text-nd-text-secondary'
              )}
            >
              {tab.label}
            </button>
          ))}
          <div className="flex-1" />
          <button
            onClick={() => setFavoritesOnly((value) => !value)}
            title="Favourites only"
            className={cn(
              'p-1 rounded transition-colors',
              favoritesOnly
                ? 'text-yellow-400'
                : 'text-nd-text-muted hover:text-nd-text-primary'
            )}
          >
            <Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} />
          </button>
        </div>

        <label className="flex items-center gap-1.5 text-[11px] text-nd-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={thisDatabaseOnly}
            onChange={(e) => setThisDatabaseOnly(e.target.checked)}
            className="accent-nd-accent"
          />
          Only {currentDatabase || 'current database'}
        </label>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {entries.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-nd-text-muted">
            {debouncedSearch ? 'No queries match your search' : 'No history yet'}
          </div>
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.label)
            return (
              <div key={group.label}>
                <button
                  onClick={() => handleToggleGroup(group.label)}
                  className="flex items-center gap-1 w-full px-2 py-1.5 text-[11px] font-semibold text-nd-text-secondary hover:bg-nd-surface transition-colors sticky top-0 bg-nd-bg-secondary z-10"
                >
                  {isCollapsed ? (
                    <ChevronRight size={11} />
                  ) : (
                    <ChevronDown size={11} />
                  )}
                  {group.label}
                  <span className="text-nd-text-muted font-normal">
                    ({group.entries.length})
                  </span>
                </button>

                {!isCollapsed &&
                  group.entries.map((entry) => (
                    <div
                      key={entry.id}
                      onClick={() => onOpenQuery(entry.query)}
                      title="Click to open in a new query tab"
                      className={cn(
                        'group px-2.5 py-2 cursor-pointer border-b border-nd-border/60 transition-colors hover:bg-nd-surface',
                        entry.error && 'border-l-2 border-l-red-500/40'
                      )}
                    >
                      <p className="text-[11px] font-mono text-nd-text-primary break-all leading-relaxed line-clamp-3">
                        {compact(entry.query)}
                      </p>

                      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-nd-text-muted">
                        <span>{timeLabel(entry.executedAt)}</span>
                        {entry.error ? (
                          <span className="flex items-center gap-1 text-red-400">
                            <AlertCircle size={9} />
                            ERROR
                          </span>
                        ) : (
                          <>
                            {entry.rowCount !== undefined && (
                              <span>{entry.rowCount} rows</span>
                            )}
                            <span>{entry.executionTimeMs}ms</span>
                          </>
                        )}
                        {entry.database && (
                          <span className="truncate">{entry.database}</span>
                        )}

                        <div className="flex-1" />

                        <button
                          onClick={(e) => handleFavorite(e, entry.id)}
                          title={
                            entry.isFavorite
                              ? 'Remove from favourites'
                              : 'Add to favourites'
                          }
                          className={cn(
                            'p-0.5 rounded transition-colors',
                            entry.isFavorite
                              ? 'text-yellow-400'
                              : 'text-nd-text-muted/40 hover:text-yellow-400 opacity-0 group-hover:opacity-100'
                          )}
                        >
                          <Star
                            size={11}
                            fill={entry.isFavorite ? 'currentColor' : 'none'}
                          />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, entry.id)}
                          title="Delete this entry"
                          className="p-0.5 rounded text-nd-text-muted/40 hover:text-nd-error opacity-0 group-hover:opacity-100 transition-colors"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )
          })
        )}
      </div>

      <div className="flex items-center justify-between px-2 py-1.5 border-t border-nd-border shrink-0">
        <span className="text-[10px] text-nd-text-muted">{total} entries</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-[11px]"
          onClick={handleClear}
        >
          <Trash2 size={11} />
          Clear
        </Button>
      </div>
    </div>
  )
}

export default HistoryPanel
