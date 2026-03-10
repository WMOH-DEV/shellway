import { useState, useCallback, useRef, useMemo } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore } from '@/stores/connectionStore'
import { PaneTabBar } from './PaneTabBar'
import { ConnectionView } from '@/components/ConnectionView'
import { DatabaseView } from '@/components/DatabaseView'
import { Tooltip } from '@/components/ui/Tooltip'

/**
 * Height of the pane tab bar in pixels.
 * Content areas are offset by this amount.
 */
const TAB_BAR_HEIGHT = 36

/**
 * Workspace layout that orchestrates 1 or 2 panes.
 *
 * CRITICAL ARCHITECTURE — Absolute Positioning for Stable React Tree:
 *
 * The #1 invariant: ConnectionView/DatabaseView components must NEVER change their
 * position in the React tree. xterm.js terminals are destroyed on unmount and cannot
 * be recovered — any React tree restructuring (e.g., moving a component from one
 * parent div to another) causes unmount → remount → SSH shell restart.
 *
 * Solution: Three absolutely-positioned layers:
 *
 * 1. CONTENT LAYER — a single flat list of ALL tab content. Each tab is keyed by
 *    tab.id and NEVER moves in the React tree. CSS left/top/width/height changes
 *    based on which pane owns the tab. Only the active tab per pane is visible.
 *
 * 2. CHROME LAYER — tab bars positioned absolutely to match each pane's area.
 *    Lightweight UI that CAN safely restructure (no persistent state).
 *
 * 3. DIVIDER LAYER — the interactive resize handle between panes.
 *
 * This means closing/opening panes, moving tabs between panes, and toggling split
 * mode ONLY changes CSS properties — the React component tree stays completely stable.
 */
export function WorkspaceLayout() {
  const { panes, tabs, activePaneId, splitDirection, setActivePane, closePane } =
    useConnectionStore()

  const isSplit = panes.length >= 2
  const isHorizontal = splitDirection === 'horizontal'
  const [splitRatio, setSplitRatio] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Build a lookup: tabId → { paneIndex, isActive } ──
  const tabPaneMap = useMemo(() => {
    const map = new Map<string, { paneIndex: number; isActiveInPane: boolean }>()
    panes.forEach((pane, index) => {
      for (const tabId of pane.tabIds) {
        map.set(tabId, {
          paneIndex: index,
          isActiveInPane: tabId === pane.activeTabId,
        })
      }
    })
    return map
  }, [panes])

  // ── Drag handler for resize divider ──
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()

      const onMove = (ev: MouseEvent) => {
        let ratio: number
        if (isHorizontal) {
          ratio = ((ev.clientX - rect.left) / rect.width) * 100
        } else {
          ratio = ((ev.clientY - rect.top) / rect.height) * 100
        }
        // Enforce min sizes (~300px equivalent)
        const containerSize = isHorizontal ? rect.width : rect.height
        const minPercent = (300 / containerSize) * 100
        ratio = Math.max(minPercent, Math.min(100 - minPercent, ratio))
        setSplitRatio(ratio)
      }

      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [isHorizontal]
  )

  // ── Compute absolute CSS position for a pane's tab bar ──
  function getTabBarStyle(paneIndex: number): React.CSSProperties {
    if (!isSplit) {
      // Single pane — tab bar at the very top, full width
      return {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: TAB_BAR_HEIGHT,
      }
    }

    if (isHorizontal) {
      // Horizontal split: pane 0 tab bar on the left, pane 1 on the right
      if (paneIndex === 0) {
        return {
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${splitRatio}%`,
          height: TAB_BAR_HEIGHT,
        }
      } else {
        return {
          position: 'absolute',
          top: 0,
          left: `calc(${splitRatio}% + 1px)`,
          right: 0,
          height: TAB_BAR_HEIGHT,
        }
      }
    } else {
      // Vertical split: pane 0 tab bar at top, pane 1 tab bar at split line
      if (paneIndex === 0) {
        return {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: TAB_BAR_HEIGHT,
        }
      } else {
        return {
          position: 'absolute',
          top: `calc(${splitRatio}% + 1px)`,
          left: 0,
          right: 0,
          height: TAB_BAR_HEIGHT,
        }
      }
    }
  }

  // ── Compute absolute CSS position for a tab's content ──
  function getTabContentStyle(tabId: string): React.CSSProperties {
    const info = tabPaneMap.get(tabId)
    if (!info) {
      return { display: 'none' }
    }

    const { paneIndex, isActiveInPane } = info

    // Only the active tab in each pane is visible
    if (!isActiveInPane) {
      return { display: 'none' }
    }

    // Single pane — full area below tab bar
    if (!isSplit) {
      return {
        position: 'absolute',
        top: TAB_BAR_HEIGHT,
        left: 0,
        right: 0,
        bottom: 0,
      }
    }

    if (isHorizontal) {
      // Horizontal split: side by side, both below their tab bar
      if (paneIndex === 0) {
        return {
          position: 'absolute',
          top: TAB_BAR_HEIGHT,
          left: 0,
          width: `${splitRatio}%`,
          bottom: 0,
        }
      } else {
        return {
          position: 'absolute',
          top: TAB_BAR_HEIGHT,
          left: `calc(${splitRatio}% + 1px)`,
          right: 0,
          bottom: 0,
        }
      }
    } else {
      // Vertical split: stacked, each below its own tab bar
      if (paneIndex === 0) {
        return {
          position: 'absolute',
          top: TAB_BAR_HEIGHT,
          left: 0,
          right: 0,
          height: `calc(${splitRatio}% - ${TAB_BAR_HEIGHT}px)`,
        }
      } else {
        return {
          position: 'absolute',
          top: `calc(${splitRatio}% + 1px + ${TAB_BAR_HEIGHT}px)`,
          left: 0,
          right: 0,
          bottom: 0,
        }
      }
    }
  }

  // ── Render a pane's chrome (tab bar + close button) ──
  function renderPaneChrome(paneIndex: number) {
    const pane = panes[paneIndex]
    if (!pane) return null
    const isFocused = pane.id === activePaneId

    return (
      <div
        className="flex items-center z-10"
        style={getTabBarStyle(paneIndex)}
        onClick={() => setActivePane(pane.id)}
      >
        <div className="flex-1 min-w-0 h-full">
          <PaneTabBar
            pane={pane}
            isFocused={isFocused}
            onFocus={() => setActivePane(pane.id)}
          />
        </div>
        {isSplit && (
          <Tooltip content="Close Pane">
            <button
              onClick={(e) => {
                e.stopPropagation()
                closePane(pane.id)
              }}
              className="shrink-0 h-full px-2 flex items-center text-nd-text-muted hover:text-nd-danger hover:bg-nd-surface/60 transition-colors"
            >
              <X size={14} />
            </button>
          </Tooltip>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="h-full relative overflow-hidden">
      {/*
        ═══════════════════════════════════════════
        LAYER 1: TAB CONTENT (ConnectionView / DatabaseView)
        — Single flat list, absolutely positioned
        — React tree position NEVER changes
        ═══════════════════════════════════════════
      */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="overflow-hidden"
          style={getTabContentStyle(tab.id)}
          onClick={() => {
            const info = tabPaneMap.get(tab.id)
            if (info !== undefined) {
              const targetPaneId = panes[info.paneIndex]?.id ?? panes[0]?.id
              if (targetPaneId && targetPaneId !== activePaneId) {
                setActivePane(targetPaneId)
              }
            }
          }}
        >
          {tab.type === 'database' ? (
            <DatabaseView tab={tab} />
          ) : (
            <ConnectionView tab={tab} />
          )}
        </div>
      ))}

      {/*
        ═══════════════════════════════════════════
        LAYER 2: CHROME (tab bars per pane)
        — Absolutely positioned to match pane areas
        — Lightweight, safe to restructure
        ═══════════════════════════════════════════
      */}
      {renderPaneChrome(0)}
      {isSplit && renderPaneChrome(1)}

      {/*
        ═══════════════════════════════════════════
        LAYER 3: RESIZE DIVIDER (full height, interactive)
        ═══════════════════════════════════════════
      */}
      {isSplit && (
        <div
          onMouseDown={handleDragStart}
          className={cn(
            'absolute z-20 group',
            isHorizontal
              ? 'top-0 bottom-0 w-2 -translate-x-1/2 cursor-col-resize'
              : 'left-0 right-0 h-2 -translate-y-1/2 cursor-row-resize'
          )}
          style={
            isHorizontal
              ? { left: `${splitRatio}%` }
              : { top: `${splitRatio}%` }
          }
        >
          {/* Visible line — 1px centered inside the wider hit zone */}
          <div
            className={cn(
              'absolute bg-nd-border group-hover:bg-nd-accent transition-colors duration-150',
              isHorizontal
                ? 'top-0 bottom-0 left-1/2 w-px -translate-x-1/2'
                : 'left-0 right-0 top-1/2 h-px -translate-y-1/2'
            )}
          />
        </div>
      )}
    </div>
  )
}
