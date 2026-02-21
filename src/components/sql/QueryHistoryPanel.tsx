import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Search, Star, X, AlertCircle, Clock, Trash2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { useSQLConnection } from '@/stores/sqlStore'
import type { QueryHistoryEntry } from '@/types/sql'

// ── Props ──

interface QueryHistoryPanelProps {
  connectionId: string
  sqlSessionId: string
  /** If provided, entries become clickable to load query into editor */
  onSelectQuery?: (query: string) => void
  onClose: () => void
}

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

// ── Truncate query text to ~3 lines ──

function truncateQuery(query: string, maxLines = 3): string {
  const lines = query.split('\n')
  if (lines.length <= maxLines) return query.trim()
  return lines.slice(0, maxLines).join('\n').trim() + '...'
}

// ── History list item ──

interface HistoryItemProps {
  entry: QueryHistoryEntry
  onSelect?: (query: string) => void
  onToggleFavorite: (id: string) => void
}

const HistoryItem = React.memo(function HistoryItem({
  entry,
  onSelect,
  onToggleFavorite,
}: HistoryItemProps) {
  const handleClick = useCallback(() => {
    onSelect?.(entry.query)
  }, [entry.query, onSelect])

  const handleDoubleClick = useCallback(() => {
    onSelect?.(entry.query)
  }, [entry.query, onSelect])

  const handleStar = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onToggleFavorite(entry.id)
    },
    [entry.id, onToggleFavorite]
  )

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        'group px-3 py-2.5 cursor-pointer border-b border-nd-border transition-colors',
        'hover:bg-nd-surface',
        entry.error && 'border-l-2 border-l-red-500/40'
      )}
    >
      {/* Query text */}
      <pre className="text-xs text-nd-text-primary font-mono whitespace-pre-wrap break-all leading-relaxed line-clamp-3">
        {truncateQuery(entry.query)}
      </pre>

      {/* Meta row */}
      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-nd-text-muted">
        {entry.error ? (
          <span className="flex items-center gap-1 text-red-400">
            <AlertCircle size={10} />
            ERROR
          </span>
        ) : (
          <>
            {entry.rowCount !== undefined && (
              <span>{entry.rowCount} rows</span>
            )}
            <span className="text-nd-text-muted/50">|</span>
            <span>{entry.executionTimeMs}ms</span>
          </>
        )}
        <span className="text-nd-text-muted/50">|</span>
        <span className="flex items-center gap-1">
          <Clock size={9} />
          {formatRelativeTime(entry.executedAt)}
        </span>

        {/* Spacer + star */}
        <div className="flex-1" />
        <button
          onClick={handleStar}
          className={cn(
            'p-0.5 rounded transition-colors',
            entry.isFavorite
              ? 'text-yellow-400 hover:text-yellow-300'
              : 'text-nd-text-muted/30 hover:text-yellow-400 opacity-0 group-hover:opacity-100'
          )}
          title={entry.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={12} fill={entry.isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  )
})

// ── Virtual scroll wrapper (simple windowing for >100 items) ──

const ITEM_HEIGHT = 80 // approximate px per history item

function VirtualList({
  items,
  renderItem,
}: {
  items: QueryHistoryEntry[]
  renderItem: (entry: QueryHistoryEntry) => React.ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleScroll = useCallback(() => {
    if (containerRef.current) setScrollTop(containerRef.current.scrollTop)
  }, [])

  const totalHeight = items.length * ITEM_HEIGHT
  const overscan = 5
  const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - overscan)
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + overscan
  )

  const visibleItems = items.slice(startIndex, endIndex)

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto min-h-0"
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: startIndex * ITEM_HEIGHT, left: 0, right: 0 }}>
          {visibleItems.map((entry) => (
            <div key={entry.id}>{renderItem(entry)}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main panel ──

export function QueryHistoryPanel({
  connectionId,
  sqlSessionId,
  onSelectQuery,
  onClose,
}: QueryHistoryPanelProps) {
  const {
    history,
    toggleHistoryFavorite,
    clearHistory,
  } = useSQLConnection(connectionId)

  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'all' | 'favorites'>('all')

  // Filtered list
  const filteredHistory = useMemo(() => {
    let items = history
    if (tab === 'favorites') {
      items = items.filter((h) => h.isFavorite)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((h) => h.query.toLowerCase().includes(q))
    }
    return items
  }, [history, tab, search])

  const useVirtualScroll = filteredHistory.length > 100

  const handleClearAll = useCallback(() => {
    if (window.confirm('Clear all non-favorited history entries?')) {
      clearHistory()
    }
  }, [clearHistory])

  const renderItem = useCallback(
    (entry: QueryHistoryEntry) => (
      <HistoryItem
        entry={entry}
        onSelect={onSelectQuery}
        onToggleFavorite={toggleHistoryFavorite}
      />
    ),
    [onSelectQuery, toggleHistoryFavorite]
  )

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md h-full bg-nd-bg-secondary border-l border-nd-border flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-nd-border shrink-0">
          <h2 className="text-sm font-semibold text-nd-text-primary">Query History</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClearAll}
              title="Clear non-favorited history"
            >
              <Trash2 size={14} />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} title="Close">
              <X size={14} />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-nd-border shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-nd-surface border border-nd-border focus-within:border-nd-accent">
            <Search size={13} className="text-nd-text-muted shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search queries..."
              className="flex-1 bg-transparent text-xs text-nd-text-primary placeholder:text-nd-text-muted outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="text-nd-text-muted hover:text-nd-text-primary"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-nd-border shrink-0">
          <button
            onClick={() => setTab('all')}
            className={cn(
              'px-2.5 py-1 rounded text-xs font-medium transition-colors',
              tab === 'all'
                ? 'bg-nd-surface text-nd-text-primary'
                : 'text-nd-text-muted hover:text-nd-text-secondary'
            )}
          >
            All
          </button>
          <button
            onClick={() => setTab('favorites')}
            className={cn(
              'px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1',
              tab === 'favorites'
                ? 'bg-nd-surface text-nd-text-primary'
                : 'text-nd-text-muted hover:text-nd-text-secondary'
            )}
          >
            <Star size={11} />
            Favorites
          </button>
        </div>

        {/* List */}
        {filteredHistory.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-nd-text-muted">
            {tab === 'favorites'
              ? 'No favorite queries yet'
              : search
                ? 'No queries match your search'
                : 'No query history'}
          </div>
        ) : useVirtualScroll ? (
          <VirtualList items={filteredHistory} renderItem={renderItem} />
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">
            {filteredHistory.map((entry) => (
              <HistoryItem
                key={entry.id}
                entry={entry}
                onSelect={onSelectQuery}
                onToggleFavorite={toggleHistoryFavorite}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default QueryHistoryPanel
