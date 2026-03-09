import { useState, useCallback, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore } from '@/stores/connectionStore'
import { PaneTabBar } from './PaneTabBar'
import { ConnectionView } from '@/components/ConnectionView'
import { DatabaseView } from '@/components/DatabaseView'
import { Tooltip } from '@/components/ui/Tooltip'

/**
 * Workspace layout that orchestrates 1 or 2 panes.
 * Each pane has its own PaneTabBar + content area.
 *
 * CRITICAL: The DOM structure must stay STABLE when toggling between 1 and 2 panes.
 * If the tree changes from <div> to <Splitter>, React unmounts everything — destroying
 * terminal instances and reopening SSH shells. Instead, we use a consistent flexbox
 * layout: pane 0 is ALWAYS the first child, the divider + pane 1 appear/disappear as
 * additional siblings. This keeps pane 0's subtree in the same React tree position.
 */
export function WorkspaceLayout() {
  const { panes, tabs, activePaneId, splitDirection, setActivePane, closePane } =
    useConnectionStore()

  const isSplit = panes.length >= 2
  const isHorizontal = splitDirection === 'horizontal'
  const [splitRatio, setSplitRatio] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)

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

  // ── Render a pane's content area (tabs with CSS hidden pattern) ──
  function renderPaneContent(paneId: string) {
    const pane = panes.find((p) => p.id === paneId)
    if (!pane) return null

    return (
      <div className="flex-1 overflow-hidden relative">
        {pane.tabIds.map((tabId) => {
          const tab = tabs.find((t) => t.id === tabId)
          if (!tab) return null
          const isVisible = tab.id === pane.activeTabId
          return (
            <div key={tab.id} className={cn('h-full', !isVisible && 'hidden')}>
              {tab.type === 'database' ? (
                <DatabaseView tab={tab} />
              ) : (
                <ConnectionView tab={tab} />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // ── Render a full pane (tab bar + content) ──
  function renderPane(paneId: string | undefined) {
    if (!paneId) return null
    const pane = panes.find((p) => p.id === paneId)
    if (!pane) return null
    const isFocused = paneId === activePaneId

    return (
      <div
        className="flex flex-col h-full overflow-hidden"
        onClick={() => setActivePane(paneId)}
      >
        <div className="relative flex items-center">
          <div className="flex-1 min-w-0">
            <PaneTabBar
              pane={pane}
              isFocused={isFocused}
              onFocus={() => setActivePane(paneId)}
            />
          </div>
          {isSplit && (
            <Tooltip content="Close Pane">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closePane(paneId)
                }}
                className="shrink-0 h-[36px] px-2 flex items-center text-nd-text-muted hover:text-nd-danger hover:bg-nd-surface/60 transition-colors"
              >
                <X size={14} />
              </button>
            </Tooltip>
          )}
        </div>
        {renderPaneContent(paneId)}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={cn('h-full flex overflow-hidden', !isHorizontal && 'flex-col')}
    >
      {/* Pane 0 — ALWAYS rendered as first child to keep React tree position stable */}
      <div
        className="overflow-hidden"
        style={isSplit
          ? { [isHorizontal ? 'width' : 'height']: `${splitRatio}%` }
          : { flex: 1 }
        }
      >
        {renderPane(panes[0]?.id)}
      </div>

      {/* Resize divider — only when split */}
      {isSplit && (
        <div
          onMouseDown={handleDragStart}
          className={cn(
            'shrink-0 bg-nd-border hover:bg-nd-accent transition-colors duration-150 z-10',
            isHorizontal
              ? 'w-px cursor-col-resize hover:w-0.5'
              : 'h-px cursor-row-resize hover:h-0.5'
          )}
        />
      )}

      {/* Pane 1 — only rendered when split */}
      {isSplit && (
        <div className="flex-1 overflow-hidden">
          {renderPane(panes[1]?.id)}
        </div>
      )}
    </div>
  )
}
