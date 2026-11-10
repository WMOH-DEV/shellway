import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { VirtualList } from '@/components/ui/VirtualList'
import { useSQLConnection } from '@/stores/sqlStore'
import { useSqlTabSettings } from '@/stores/sqlTabSettingsStore'
import type { SQLTab } from '@/types/sql'
import { cn } from '@/utils/cn'
import type { TabActions } from './tabActions'
import { buildTabContextMenu, runTabContextAction } from './tabContextMenu'
import { tabKind } from './tabModel'
import { kindBarClass, tabTitle } from './tabPresentation'
import { buildGroups, type GroupMode, type VerticalRow } from './verticalGroups'

const GROUP_MODE_STORAGE_KEY = 'sql-vertical-tabs-group'
const DRAG_MIME_TYPE = 'text/x-sql-tab'
const ROW_HEIGHT = 28

type TabRowData = Extract<VerticalRow, { type: 'tab' }>
type GroupRowData = Extract<VerticalRow, { type: 'group' }>

const GROUP_MODES: { mode: GroupMode; label: string }[] = [
  { mode: 'database', label: 'DB' },
  { mode: 'kind', label: 'Kind' }
]

function readGroupMode(): GroupMode {
  try {
    return localStorage.getItem(GROUP_MODE_STORAGE_KEY) === 'kind' ? 'kind' : 'database'
  } catch {
    return 'database'
  }
}

function writeGroupMode(mode: GroupMode): void {
  try {
    localStorage.setItem(GROUP_MODE_STORAGE_KEY, mode)
  } catch {
    return
  }
}

function isTabRow(row: VerticalRow): row is TabRowData {
  return row.type === 'tab'
}

function findTabElement(root: HTMLElement | null, tabId: string): HTMLElement | undefined {
  const elements = root?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []
  return Array.from(elements).find((element) => element.dataset.tabId === tabId)
}

interface DragHandlers {
  start: (tab: SQLTab, event: DragEvent) => void
  accepts: (target: SQLTab) => boolean
  drop: (targetIndex: number) => void
  end: () => void
}

interface GroupRowProps {
  row: GroupRowData
  onToggle: (key: string) => void
}

function GroupRow({ row, onToggle }: GroupRowProps) {
  const Chevron = row.collapsed ? ChevronRight : ChevronDown
  return (
    <button
      type="button"
      aria-expanded={!row.collapsed}
      onClick={() => onToggle(row.key)}
      className="flex w-full items-center gap-1.5 px-3 h-full text-[11px] font-semibold uppercase tracking-wider text-nd-text-dim hover:text-nd-text-secondary"
    >
      <Chevron size={12} />
      <span>{row.label}</span>
      <span className="ml-auto font-normal">{row.count}</span>
    </button>
  )
}

interface TabRowProps {
  row: TabRowData
  tabs: SQLTab[]
  isActive: boolean
  tabIndex: number
  showKindBar: boolean
  actions: TabActions
  drag: DragHandlers
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, tab: SQLTab) => void
}

function TabRow({ row, tabs, isActive, tabIndex, showKindBar, actions, drag, onKeyDown }: TabRowProps) {
  const { tab, index } = row
  return (
    <ContextMenu
      className="h-full"
      items={buildTabContextMenu(tab, tabs)}
      onSelect={(id) => runTabContextAction(id, tab, tabs, actions)}
    >
      <div
        role="tab"
        aria-selected={isActive}
        tabIndex={tabIndex}
        data-tab-id={tab.id}
        draggable
        onClick={() => actions.activate(tab.id)}
        onDoubleClick={() => actions.promote(tab.id)}
        onKeyDown={(event) => onKeyDown(event, tab)}
        onDragStart={(event) => drag.start(tab, event)}
        onDragOver={(event) => drag.accepts(tab) && event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          drag.drop(index)
        }}
        onDragEnd={drag.end}
        className={cn(
          'group relative flex items-center gap-2 h-full pl-4 pr-2 mx-1 rounded-md text-xs cursor-pointer',
          isActive
            ? 'bg-nd-surface-raised text-nd-text-primary'
            : 'text-nd-text-secondary hover:bg-nd-surface-hover'
        )}
      >
        {showKindBar && <span className={cn('w-[3px] h-3.5 rounded-full shrink-0', kindBarClass(tabKind(tab)))} />}
        <span className={cn('truncate', tab.preview && 'italic')}>{tabTitle(tab)}</span>
        {tab.preview && <span className="shrink-0 text-[11px] text-nd-text-muted">preview</span>}
        <span className="flex-1" />
        {tab.isDirty && <span aria-label="Unsaved" className="w-1.5 h-1.5 rounded-full bg-nd-warning shrink-0" />}
        {!tab.pinned && (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Close tab"
            onClick={(event) => {
              event.stopPropagation()
              actions.close(tab.id)
            }}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-nd-text-muted hover:text-nd-text-primary"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </ContextMenu>
  )
}

interface GroupModeToggleProps {
  mode: GroupMode
  onChange: (mode: GroupMode) => void
}

function GroupModeToggle({ mode, onChange }: GroupModeToggleProps) {
  return (
    <div className="flex items-center gap-0.5">
      {GROUP_MODES.map((option) => (
        <button
          key={option.mode}
          type="button"
          aria-pressed={mode === option.mode}
          onClick={() => onChange(option.mode)}
          className={cn(
            'h-5 px-1.5 rounded text-[11px]',
            mode === option.mode
              ? 'bg-nd-surface-raised text-nd-text-primary'
              : 'text-nd-text-muted hover:text-nd-text-secondary'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

interface VerticalTabListProps {
  connectionId: string
  actions: TabActions
}

export function VerticalTabList({ connectionId, actions }: VerticalTabListProps) {
  const { tabs, activeTabId } = useSQLConnection(connectionId)
  const { sqlColorByKind } = useSqlTabSettings()
  const [groupMode, setGroupMode] = useState<GroupMode>(readGroupMode)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => buildGroups(tabs, groupMode, filter, collapsed), [tabs, groupMode, filter, collapsed])
  const tabRows = useMemo(() => rows.filter(isTabRow), [rows])
  const focusableId = tabRows.some((row) => row.tab.id === activeTabId) ? activeTabId : tabRows[0]?.tab.id
  const draggedTab = tabs.find((tab) => tab.id === draggedId)
  const scrollToIndex = pendingFocusId ? rows.findIndex((row) => row.key === `tab:${pendingFocusId}`) : undefined

  useEffect(() => {
    if (!pendingFocusId) return
    const element = findTabElement(rootRef.current, pendingFocusId)
    if (!element) return
    element.focus()
    setPendingFocusId(null)
  })

  const changeGroupMode = (mode: GroupMode): void => {
    setGroupMode(mode)
    writeGroupMode(mode)
  }

  const toggleGroup = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  const focusTab = (tabId: string): void => {
    const element = findTabElement(rootRef.current, tabId)
    if (element) element.focus()
    else setPendingFocusId(tabId)
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, tab: SQLTab): void => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter') return actions.activate(tab.id)
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const position = tabRows.findIndex((row) => row.tab.id === tab.id)
    const target = tabRows[position + step]
    if (target) focusTab(target.tab.id)
  }

  const drag: DragHandlers = {
    start: (tab, event) => {
      event.dataTransfer.setData(DRAG_MIME_TYPE, tab.id)
      setDraggedId(tab.id)
    },
    accepts: (target) => !!draggedTab && draggedTab.id !== target.id && !!draggedTab.pinned === !!target.pinned,
    drop: (targetIndex) => {
      if (draggedId) actions.move(draggedId, targetIndex)
      setDraggedId(null)
    },
    end: () => setDraggedId(null)
  }

  const renderRow = (row: VerticalRow) =>
    row.type === 'group' ? (
      <GroupRow row={row} onToggle={toggleGroup} />
    ) : (
      <TabRow
        row={row}
        tabs={tabs}
        isActive={row.tab.id === activeTabId}
        tabIndex={row.tab.id === focusableId ? 0 : -1}
        showKindBar={sqlColorByKind}
        actions={actions}
        drag={drag}
        onKeyDown={handleTabKeyDown}
      />
    )

  return (
    <div ref={rootRef} className="flex flex-col min-h-0 max-h-[45%] border-b border-nd-border">
      <div className="flex items-center gap-2 px-3 h-8 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-nd-text-dim">Open</span>
        <span className="rounded bg-nd-surface-raised px-1.5 text-[11px] text-nd-text-muted">{tabs.length}</span>
        <span className="flex-1" />
        <GroupModeToggle mode={groupMode} onChange={changeGroupMode} />
      </div>
      <input
        type="text"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter open tabs"
        aria-label="Filter open tabs"
        className="mx-2 mb-1 h-7 shrink-0 px-2 rounded-md border border-nd-border bg-nd-bg-sunken text-xs outline-none focus:border-nd-accent"
      />
      <VirtualList
        items={rows}
        rowHeight={ROW_HEIGHT}
        role="tablist"
        ariaLabel="Open tabs"
        className="flex-1 min-h-0"
        getKey={(row) => row.key}
        scrollToIndex={scrollToIndex}
        renderRow={renderRow}
      />
    </div>
  )
}
