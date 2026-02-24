import { memo, useCallback, useRef, useMemo, type MouseEvent } from 'react'
import { Table2, Code2, Columns3, Plus, X, XCircle } from 'lucide-react'
import { cn } from '@/utils/cn'
import { ContextMenu, type ContextMenuItem } from '@/components/ui/ContextMenu'
import type { SQLTab, SQLTabType } from '@/types/sql'

// ── Props ──

interface SQLTabBarProps {
  tabs: SQLTab[]
  activeTabId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseTabs: (ids: string[]) => void
  onNewQuery: () => void
}

// ── Context menu action IDs ──

type TabContextAction = 'close' | 'close-others' | 'close-all' | 'close-left' | 'close-right'

// ── Tab type icons ──

const tabIcons: Record<SQLTabType, React.ReactNode> = {
  data: <Table2 size={13} />,
  query: <Code2 size={13} />,
  structure: <Columns3 size={13} />,
}

// ── Single tab ──

interface TabItemProps {
  tab: SQLTab
  isActive: boolean
  index: number
  totalTabs: number
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onContextAction: (tabId: string, action: TabContextAction) => void
}

const TabItem = memo(function TabItem({
  tab,
  isActive,
  index,
  totalTabs,
  onSelect,
  onClose,
  onContextAction,
}: TabItemProps) {
  const handleClick = useCallback(() => onSelect(tab.id), [onSelect, tab.id])

  const handleClose = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      onClose(tab.id)
    },
    [onClose, tab.id]
  )

  const handleMiddleClick = useCallback(
    (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault()
        onClose(tab.id)
      }
    },
    [onClose, tab.id]
  )

  // Build context menu items — disable options that have no effect
  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const hasTabsToLeft = index > 0
    const hasTabsToRight = index < totalTabs - 1
    const hasOtherTabs = totalTabs > 1

    return [
      { id: 'close', label: 'Close', icon: <X size={14} /> },
      { id: 'close-others', label: 'Close Others', disabled: !hasOtherTabs },
      { id: 'separator-1', label: '', separator: true },
      { id: 'close-left', label: 'Close Tabs to the Left', disabled: !hasTabsToLeft },
      { id: 'close-right', label: 'Close Tabs to the Right', disabled: !hasTabsToRight },
      { id: 'separator-2', label: '', separator: true },
      { id: 'close-all', label: 'Close All Tabs', icon: <XCircle size={14} />, danger: true },
    ]
  }, [index, totalTabs])

  const handleContextMenuSelect = useCallback(
    (actionId: string) => {
      onContextAction(tab.id, actionId as TabContextAction)
    },
    [tab.id, onContextAction]
  )

  return (
    <ContextMenu items={contextMenuItems} onSelect={handleContextMenuSelect} className="shrink-0">
      <button
        onClick={handleClick}
        onMouseDown={handleMiddleClick}
        className={cn(
          'group relative flex items-center gap-1.5 shrink-0',
          'px-3 py-1.5 text-xs font-medium transition-colors',
          'border-r border-nd-border',
          isActive
            ? 'bg-nd-bg-primary text-nd-text-primary'
            : 'bg-nd-bg-secondary text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
        )}
      >
        {tabIcons[tab.type]}
        <span className="max-w-[120px] truncate">{tab.label}</span>

        {/* Dirty indicator */}
        {tab.isDirty && (
          <span className="w-1.5 h-1.5 rounded-full bg-nd-warning shrink-0" />
        )}

        {/* Close button */}
        <span
          onClick={handleClose}
          className={cn(
            'ml-0.5 p-0.5 rounded-sm shrink-0',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'hover:bg-nd-surface-hover hover:text-nd-text-primary'
          )}
          role="button"
          tabIndex={-1}
        >
          <X size={12} />
        </span>

        {/* Active indicator line */}
        {isActive && (
          <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-nd-accent" />
        )}
      </button>
    </ContextMenu>
  )
})

// ── Tab bar ──

export const SQLTabBar = memo(function SQLTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCloseTabs,
  onNewQuery,
}: SQLTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleNewQuery = useCallback(() => onNewQuery(), [onNewQuery])

  // Handle context menu actions — lifted here so TabItem doesn't need the full tabs array
  const handleContextAction = useCallback(
    (tabId: string, action: TabContextAction) => {
      const tabIndex = tabs.findIndex((t) => t.id === tabId)
      if (tabIndex === -1) return

      switch (action) {
        case 'close':
          onClose(tabId)
          break
        case 'close-others':
          onCloseTabs(tabs.filter((t) => t.id !== tabId).map((t) => t.id))
          break
        case 'close-all':
          onCloseTabs(tabs.map((t) => t.id))
          break
        case 'close-left':
          onCloseTabs(tabs.slice(0, tabIndex).map((t) => t.id))
          break
        case 'close-right':
          onCloseTabs(tabs.slice(tabIndex + 1).map((t) => t.id))
          break
      }
    },
    [tabs, onClose, onCloseTabs]
  )

  return (
    <div className="flex items-center border-b border-nd-border bg-nd-bg-secondary min-h-[32px]">
      {/* Scrollable tabs */}
      <div
        ref={scrollRef}
        className="flex items-center overflow-x-auto scrollbar-none flex-1"
      >
        {tabs.map((tab, idx) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            index={idx}
            totalTabs={tabs.length}
            onSelect={onSelect}
            onClose={onClose}
            onContextAction={handleContextAction}
          />
        ))}
      </div>

      {/* New query button */}
      <button
        onClick={handleNewQuery}
        className="shrink-0 p-1.5 mx-1 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
        title="New Query Tab"
      >
        <Plus size={14} />
      </button>
    </div>
  )
})
