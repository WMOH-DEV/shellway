import { useEffect, useRef, useState, useCallback } from 'react'
import { ArrowDown } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useLogStore } from '@/stores/logStore'
import { LogToolbar } from './LogToolbar'
import { LogEntry } from './LogEntry'
import { Button } from '@/components/ui/Button'

interface ActivityLogProps {
  sessionId: string
}

/**
 * Activity Log panel — scrollable list of log entries with auto-scroll,
 * filtering, and expandable details.
 */
export function ActivityLog({ sessionId }: ActivityLogProps) {
  const { getFilteredEntries, autoScroll, setAutoScroll } = useLogStore()
  const entries = getFilteredEntries(sessionId)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showJumpButton, setShowJumpButton] = useState(false)
  const isUserScrollingRef = useRef(false)

  /** Toggle expanded state of an entry */
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  /** Auto-scroll to bottom when new entries arrive */
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return

    const el = scrollRef.current
    el.scrollTop = el.scrollHeight
  }, [entries.length, autoScroll])

  /** Detect when user scrolls away from bottom */
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setShowJumpButton(!isAtBottom)

    if (!isAtBottom) {
      isUserScrollingRef.current = true
      if (autoScroll) {
        setAutoScroll(false)
      }
    } else {
      isUserScrollingRef.current = false
      if (!autoScroll) {
        setAutoScroll(true)
      }
    }
  }, [autoScroll, setAutoScroll])

  /** Jump to the latest entry */
  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    el.scrollTop = el.scrollHeight
    setAutoScroll(true)
    setShowJumpButton(false)
  }, [setAutoScroll])

  return (
    <div className="flex flex-col h-full bg-nd-bg-secondary">
      {/* Toolbar */}
      <LogToolbar sessionId={sessionId} />

      {/* Log entries */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto"
        >
          {entries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-nd-text-muted">
              No log entries
            </div>
          ) : (
            entries.map((entry) => (
              <LogEntry
                key={entry.id}
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                onToggle={() => toggleExpanded(entry.id)}
              />
            ))
          )}
        </div>

        {/* Jump to latest button */}
        {showJumpButton && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
            <Button
              variant="primary"
              size="sm"
              onClick={jumpToBottom}
              className={cn(
                'shadow-lg gap-1 rounded-full px-3',
                'bg-nd-accent/90 hover:bg-nd-accent'
              )}
            >
              <ArrowDown size={12} />
              Jump to latest
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
