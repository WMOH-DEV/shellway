import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useSQLConnection } from '@/stores/sqlStore'
import { useSqlTabSettings } from '@/stores/sqlTabSettingsStore'
import { useSqlTabSnapshot } from '@/stores/sqlTabSnapshotStore'
import { getBinding } from '@/stores/keybindingStore'
import { formatCombo } from '@/utils/keybindings'
import type { SQLTab } from '@/types/sql'
import type { TabActions } from './tabActions'
import { tabKind } from './tabModel'
import { kindBarClass, kindLabel, showDatabaseLabel, tabTitle } from './tabPresentation'
import { TabStripItem } from './TabStripItem'

const SCROLL_STEP = 200

const TAB_COUNT_BUTTON_CLASS =
  'shrink-0 flex items-center gap-1 text-xs px-2 py-1.5 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors'

function useOverflow(containerRef: RefObject<HTMLDivElement | null>, enabled: boolean, tabs: SQLTab[]): boolean {
  const [overflows, setOverflows] = useState(false)

  useEffect(() => {
    const container = containerRef.current
    if (!enabled || !container) {
      setOverflows(false)
      return
    }
    const measure = (): void => setOverflows(container.scrollWidth > container.clientWidth)
    measure()
    container.addEventListener('scroll', measure)
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => {
      container.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [containerRef, enabled, tabs])

  return overflows
}

function useTabKeyboard(tabs: SQLTab[], actions: TabActions) {
  const elements = useRef(new Map<string, HTMLElement>())

  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    if (el) elements.current.set(id, el)
    else elements.current.delete(id)
  }, [])

  const focusTab = useCallback((tab: SQLTab | undefined) => {
    if (tab) elements.current.get(tab.id)?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent, tab: SQLTab) => {
      const index = tabs.findIndex((t) => t.id === tab.id)
      switch (e.key) {
        case 'ArrowRight':
          return focusTab(tabs[index + 1])
        case 'ArrowLeft':
          return focusTab(tabs[index - 1])
        case 'Home':
          return focusTab(tabs[0])
        case 'End':
          return focusTab(tabs[tabs.length - 1])
        case 'Enter':
        case ' ':
          e.preventDefault()
          return actions.activate(tab.id)
        case 'Delete':
        case 'Backspace':
          if (!tab.pinned) actions.close(tab.id)
      }
    },
    [tabs, actions, focusTab]
  )

  return { elements, registerRef, handleKeyDown }
}

interface TabCountButtonProps {
  count: number
  onOpenMenu: () => void
}

function TabCountButton({ count, onOpenMenu }: TabCountButtonProps) {
  return (
    <button
      onClick={onOpenMenu}
      aria-label="Show all tabs"
      aria-haspopup="listbox"
      className={TAB_COUNT_BUTTON_CLASS}
    >
      {count} tabs
      <ChevronDown size={12} />
    </button>
  )
}

interface TabStripProps {
  connectionId: string
  actions: TabActions
  layout: 'single' | 'wrap'
  onNewQuery: () => void
  onOpenMenu: () => void
}

export function TabStrip({ connectionId, actions, layout, onNewQuery, onOpenMenu }: TabStripProps) {
  const { tabs, activeTabId, tabsOverLimit } = useSQLConnection(connectionId)
  const settings = useSqlTabSettings()
  const containerRef = useRef<HTMLDivElement>(null)
  const { elements, registerRef, handleKeyDown } = useTabKeyboard(tabs, actions)
  const isSingle = layout === 'single'
  const overflows = useOverflow(containerRef, isSingle, tabs)
  const showDatabase = settings.sqlShowDatabaseName && showDatabaseLabel(tabs)
  const focusableId = tabs.some((t) => t.id === activeTabId) ? activeTabId : tabs[0]?.id

  useEffect(() => {
    if (!activeTabId) return
    elements.current.get(activeTabId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, elements])

  const scrollBy = (left: number): void => containerRef.current?.scrollBy({ left, behavior: 'smooth' })

  return (
    <div className="flex items-center border-b border-nd-border bg-nd-bg-secondary min-h-[32px]">
      {isSingle && overflows && (
        <button
          onClick={() => scrollBy(-SCROLL_STEP)}
          aria-label="Scroll tabs left"
          className="shrink-0 p-1.5 text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
      )}

      <div
        ref={containerRef}
        role="tablist"
        aria-orientation="horizontal"
        aria-label="SQL tabs"
        className={cn(
          'flex',
          isSingle
            ? 'items-center overflow-x-auto scrollbar-none flex-1'
            : 'flex-wrap flex-1 max-h-[96px] overflow-y-auto'
        )}
      >
        {tabs.map((tab) => (
          <TabStripItem
            key={tab.id}
            tab={tab}
            tabs={tabs}
            isActive={tab.id === activeTabId}
            showDatabase={showDatabase}
            colorByKind={settings.sqlColorByKind}
            closeOnMiddleClick={settings.sqlCloseOnMiddleClick}
            tabIndex={tab.id === focusableId ? 0 : -1}
            actions={actions}
            onKeyDown={handleKeyDown}
            registerRef={registerRef}
          />
        ))}
      </div>

      {isSingle && overflows && (
        <button
          onClick={() => scrollBy(SCROLL_STEP)}
          aria-label="Scroll tabs right"
          className="shrink-0 p-1.5 text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      )}

      {tabsOverLimit && (
        <span
          className="text-2xs text-nd-warning px-2 whitespace-nowrap"
          title="Only pinned or unsaved tabs are left to close"
        >
          Over the {settings.sqlTabLimit}-tab limit
        </span>
      )}

      <TabCountButton count={tabs.length} onOpenMenu={onOpenMenu} />

      <button
        onClick={onNewQuery}
        className="shrink-0 p-1.5 mx-1 rounded text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
        title="New Query Tab"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}

interface CurrentTabHeaderProps {
  connectionId: string
  onOpenMenu: () => void
}

export function CurrentTabHeader({ connectionId, onOpenMenu }: CurrentTabHeaderProps) {
  const { tabs, activeTabId } = useSQLConnection(connectionId)
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const snapshot = useSqlTabSnapshot(activeTab?.id)
  if (!activeTab) return null

  const kind = tabKind(activeTab)
  const rowCount = snapshot?.totalRows !== undefined ? ` · ${snapshot.totalRows.toLocaleString()} rows` : ''

  return (
    <div className="flex items-center gap-2 h-7 px-3 border-b border-nd-border bg-nd-bg-secondary text-xs">
      <span aria-hidden className={cn('w-[3px] h-3.5 rounded-full', kindBarClass(kind))} />
      <span className="text-nd-text-primary font-medium truncate">{tabTitle(activeTab)}</span>
      <span className="text-nd-text-muted">
        {kindLabel(kind)}
        {rowCount}
      </span>
      <div className="flex-1" />
      <span className="text-nd-text-muted">{formatCombo(getBinding('sql:recentTabs'))} recent tabs</span>
      <TabCountButton count={tabs.length} onOpenMenu={onOpenMenu} />
    </div>
  )
}
