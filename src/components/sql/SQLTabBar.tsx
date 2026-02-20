import { memo, useCallback, useRef, type MouseEvent } from 'react'
import { Table2, Code2, Columns3, Plus, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { SQLTab, SQLTabType } from '@/types/sql'

// ── Props ──

interface SQLTabBarProps {
  tabs: SQLTab[]
  activeTabId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNewQuery: () => void
}

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
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

const TabItem = memo(function TabItem({
  tab,
  isActive,
  onSelect,
  onClose,
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

  return (
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
  )
})

// ── Tab bar ──

export const SQLTabBar = memo(function SQLTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewQuery,
}: SQLTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const handleNewQuery = useCallback(() => onNewQuery(), [onNewQuery])

  return (
    <div className="flex items-center border-b border-nd-border bg-nd-bg-secondary min-h-[32px]">
      {/* Scrollable tabs */}
      <div
        ref={scrollRef}
        className="flex items-center overflow-x-auto scrollbar-none flex-1"
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSelect={onSelect}
            onClose={onClose}
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
