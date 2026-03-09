import { X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useConnectionStore } from '@/stores/connectionStore'
import { Splitter } from '@/components/ui/Splitter'
import { PaneTabBar } from './PaneTabBar'
import { ConnectionView } from '@/components/ConnectionView'
import { DatabaseView } from '@/components/DatabaseView'
import { Tooltip } from '@/components/ui/Tooltip'

/**
 * Workspace layout that orchestrates 1 or 2 panes.
 * Each pane has its own PaneTabBar + content area.
 * All tabs are kept in the DOM (CSS hidden pattern) to preserve terminal/SFTP state.
 */
export function WorkspaceLayout() {
  const { panes, tabs, activePaneId, splitDirection, setActivePane, closePane } =
    useConnectionStore()

  function renderPaneContent(paneId: string, paneActiveTabId: string | null) {
    const pane = panes.find((p) => p.id === paneId)
    if (!pane) return null

    return (
      <div className="flex-1 overflow-hidden relative">
        {pane.tabIds.map((tabId) => {
          const tab = tabs.find((t) => t.id === tabId)
          if (!tab) return null
          const isVisible = tab.id === paneActiveTabId
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

  function renderPane(paneId: string) {
    const pane = panes.find((p) => p.id === paneId)
    if (!pane) return null
    const isFocused = paneId === activePaneId
    const isSplit = panes.length >= 2

    return (
      <div
        className="flex flex-col h-full overflow-hidden"
        onClick={() => setActivePane(paneId)}
      >
        <div className="relative flex items-center">
          <div className="flex-1">
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
        {renderPaneContent(paneId, pane.activeTabId)}
      </div>
    )
  }

  if (panes.length === 1) {
    return <div className="h-full">{renderPane(panes[0].id)}</div>
  }

  return (
    <Splitter
      direction={splitDirection}
      defaultSplit={50}
      minSize={300}
      left={<div className="h-full">{renderPane(panes[0].id)}</div>}
      right={<div className="h-full">{renderPane(panes[1].id)}</div>}
      className="h-full"
    />
  )
}
