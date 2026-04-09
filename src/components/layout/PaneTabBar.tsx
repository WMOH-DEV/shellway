import { useRef, useState, useCallback, useMemo } from 'react'
import { X, RotateCw, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore } from '@/stores/connectionStore'
import type { Pane } from '@/stores/connectionStore'
import { useSQLStore, serializeConnectionSlice } from '@/stores/sqlStore'
import { Tooltip } from '@/components/ui/Tooltip'
import { TabContextMenu } from './TabContextMenu'
import { toast } from '@/components/ui/Toast'
import { markHandoffInFlight, clearHandoffInFlight } from '@/utils/handoff'

interface PaneTabBarProps {
  pane: Pane
  isFocused: boolean
  onFocus: () => void
}

/**
 * Tab bar for a single pane — renders tabs matching the visual design
 * of the monolithic TabBar, scoped to one pane's tab IDs.
 */
export function PaneTabBar({ pane, isFocused, onFocus }: PaneTabBarProps) {
  const { tabs, panes, removeTab, setPaneActiveTab } = useConnectionStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null)

  /** Resolve pane.tabIds to actual tab objects, preserving order */
  const paneTabs = useMemo(
    () => pane.tabIds.map(id => tabs.find(t => t.id === id)).filter(Boolean),
    [pane.tabIds, tabs]
  )

  const scroll = useCallback((dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' })
  }, [])

  const handleTabClick = useCallback((tabId: string) => {
    setPaneActiveTab(pane.id, tabId)
    onFocus()
  }, [pane.id, setPaneActiveTab, onFocus])

  const handleMiddleClick = useCallback((e: React.MouseEvent, tabId: string) => {
    if (e.button === 1) {
      e.preventDefault()
      removeTab(tabId)
    }
  }, [removeTab])

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    onFocus()
    setContextMenu({ tabId, x: e.clientX, y: e.clientY })
  }, [onFocus])

  /**
   * Tear a database tab off into its own standalone window.
   *
   * The handoff is designed to be seamless:
   *   1. Capture the current SQL store slice (tabs, history, staged changes,
   *      query editor state, …) so the new window can rehydrate it.
   *   2. Mark the connection as "handing off" so SQLView's unmount cleanup
   *      does NOT call `sql.disconnect` when we remove the tab below.
   *   3. Ask main to open a standalone window with the existing connectionId
   *      + sqlSessionId. Main pre-subscribes the new window BEFORE returning,
   *      so the connection's refcount never drops to zero during the handoff.
   *   4. Remove the tab from this window's Zustand stores. The underlying
   *      SSH/SQL connection stays alive because the new window is now the
   *      sole subscriber.
   *   5. Clear the handoff flag.
   *
   * If the open call fails at any point we clear the flag and abort — no tab
   * removal, no state loss.
   */
  const handlePopOut = useCallback(async (tabId: string) => {
    const tab = useConnectionStore.getState().tabs.find(t => t.id === tabId)
    if (!tab || tab.type !== 'database') return

    // Capture state BEFORE marking handoff so we get the live values
    const slice = serializeConnectionSlice(tabId)
    const sqlSessionId = slice?.sqlSessionId ?? null

    markHandoffInFlight(tabId)

    try {
      const result = await window.novadeck.window.openStandalone({
        mode: 'sql',
        sessionId: tab.sessionId,
        name: tab.sessionName,
        sessionColor: tab.sessionColor,
        connectionId: tabId,
        sqlSessionId,
        sqlSlice: slice ?? undefined,
      })

      // If the user clicked pop-out on a session that already had an open
      // standalone window, the main process focused that window instead of
      // creating a new one. We should NOT remove our local tab in that case.
      if (result.focusedExisting) {
        clearHandoffInFlight(tabId)
        return
      }

      // Remove from this window's stores. The handoff flag ensures SQLView's
      // unmount cleanup skips the disconnect so the main-process connection
      // stays alive for the new window to adopt.
      removeTab(tabId)
      useSQLStore.getState().removeConnection(tabId)
    } catch (err) {
      clearHandoffInFlight(tabId)
      toast.error('Pop out failed', err instanceof Error ? err.message : String(err))
      return
    }

    // Clear after a short delay so any lingering unmount effects see the flag.
    setTimeout(() => clearHandoffInFlight(tabId), 100)
  }, [removeTab])

  if (paneTabs.length === 0) return null

  const hasSplit = panes.length >= 2

  return (
    <div
      className={cn(
        'relative flex items-end h-[36px] bg-nd-bg-primary shrink-0 select-none',
        hasSplit && isFocused && 'ring-1 ring-inset ring-nd-accent/30'
      )}
    >
      {/* Scroll left */}
      {paneTabs.length > 6 && (
        <button
          onClick={() => scroll('left')}
          className="shrink-0 px-1 h-full flex items-center text-nd-text-muted hover:text-nd-text-primary transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
      )}

      {/* Tab list */}
      <div
        ref={scrollRef}
        className="flex-1 flex items-end overflow-x-auto scrollbar-none"
      >
        {paneTabs.map(tab => {
          if (!tab) return null
          const isActive = tab.id === pane.activeTabId
          const isDisconnected = tab.status === 'disconnected' || tab.status === 'error'

          return (
            <div
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              onMouseDown={(e) => handleMiddleClick(e, tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              className={cn(
                'group relative flex items-center gap-2 px-3 min-w-[130px] max-w-[200px] cursor-pointer',
                'transition-all duration-100 shrink-0',
                isActive
                  ? 'h-[36px] bg-nd-bg-tertiary border-t-2 border-t-nd-accent border-x border-x-nd-border'
                  : 'h-[32px] bg-nd-bg-secondary hover:bg-nd-bg-tertiary/60 border-t-2 border-t-transparent border-r border-r-nd-border/40',
              )}
            >
              {/* Active tab bottom edge blends with content */}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-px bg-nd-bg-tertiary" />
              )}

              {/* Status dot */}
              <span
                className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  tab.status === 'connected' && 'bg-nd-success',
                  tab.status === 'connecting' && 'bg-nd-warning animate-pulse',
                  tab.status === 'authenticating' && 'bg-nd-warning animate-pulse',
                  tab.status === 'reconnecting' && 'bg-nd-info animate-pulse',
                  isDisconnected && 'bg-nd-text-muted'
                )}
                style={tab.sessionColor && tab.status === 'connected' ? { backgroundColor: tab.sessionColor } : {}}
              />

              {/* Tab name */}
              <span className={cn(
                'text-xs truncate flex-1',
                isActive ? 'text-nd-text-primary font-medium' : 'text-nd-text-secondary'
              )}>
                {tab.sessionName}
              </span>

              {/* Reconnect overlay */}
              {isDisconnected && (
                <Tooltip content="Reconnect">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      // TODO: reconnect
                    }}
                    className="text-nd-text-muted hover:text-nd-accent transition-colors"
                  >
                    <RotateCw size={11} />
                  </button>
                </Tooltip>
              )}

              {/* Pop out (database tabs only, POC) */}
              {tab.type === 'database' && (
                <Tooltip content="Open in new window">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handlePopOut(tab.id)
                    }}
                    className={cn(
                      'shrink-0 p-0.5 rounded transition-all',
                      isActive
                        ? 'text-nd-text-muted hover:text-nd-accent hover:bg-nd-surface'
                        : 'text-nd-text-muted opacity-0 group-hover:opacity-100 hover:text-nd-accent hover:bg-nd-surface'
                    )}
                  >
                    <ExternalLink size={11} />
                  </button>
                </Tooltip>
              )}

              {/* Close button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeTab(tab.id)
                }}
                className={cn(
                  'shrink-0 p-0.5 rounded transition-all',
                  isActive
                    ? 'text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface'
                    : 'text-nd-text-muted opacity-0 group-hover:opacity-100 hover:text-nd-text-primary hover:bg-nd-surface'
                )}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Scroll right */}
      {paneTabs.length > 6 && (
        <button
          onClick={() => scroll('right')}
          className="shrink-0 px-1 h-full flex items-center text-nd-text-muted hover:text-nd-text-primary transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      )}

      {/* Bottom border line that runs under inactive tabs */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-nd-border pointer-events-none" style={{ zIndex: 0 }} />

      {/* Context menu */}
      {contextMenu && (
        <TabContextMenu
          tabId={contextMenu.tabId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
