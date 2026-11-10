import { memo, useCallback, useMemo, type KeyboardEvent, type MouseEvent } from 'react'
import { Pin, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { ContextMenu } from '@/components/ui/ContextMenu'
import type { SQLTab } from '@/types/sql'
import type { TabActions } from './tabActions'
import { buildTabContextMenu, runTabContextAction } from './tabContextMenu'
import { tabKind } from './tabModel'
import { kindBarClass, tabTitle } from './tabPresentation'

interface TabStripItemProps {
  tab: SQLTab
  tabs: SQLTab[]
  isActive: boolean
  showDatabase: boolean
  colorByKind: boolean
  closeOnMiddleClick: boolean
  tabIndex: number
  actions: TabActions
  onKeyDown: (e: KeyboardEvent, tab: SQLTab) => void
  registerRef: (id: string, el: HTMLElement | null) => void
}

function tooltipFor(tab: SQLTab): string {
  return tab.database ? `${tabTitle(tab)} · ${tab.database}` : tabTitle(tab)
}

export const TabStripItem = memo(function TabStripItem({
  tab,
  tabs,
  isActive,
  showDatabase,
  colorByKind,
  closeOnMiddleClick,
  tabIndex,
  actions,
  onKeyDown,
  registerRef
}: TabStripItemProps) {
  const menuItems = useMemo(() => buildTabContextMenu(tab, tabs), [tab, tabs])

  const handleMenuSelect = useCallback(
    (id: string) => runTabContextAction(id, tab, tabs, actions),
    [tab, tabs, actions]
  )

  const handleClick = useCallback(() => actions.activate(tab.id), [actions, tab.id])
  const handleDoubleClick = useCallback(() => actions.promote(tab.id), [actions, tab.id])
  const handleKeyDown = useCallback((e: KeyboardEvent) => onKeyDown(e, tab), [onKeyDown, tab])
  const handleRef = useCallback((el: HTMLDivElement | null) => registerRef(tab.id, el), [registerRef, tab.id])

  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      if (closeOnMiddleClick && !tab.pinned) actions.close(tab.id)
    },
    [actions, closeOnMiddleClick, tab.id, tab.pinned]
  )

  const handleClose = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation()
      actions.close(tab.id)
    },
    [actions, tab.id]
  )

  return (
    <ContextMenu items={menuItems} onSelect={handleMenuSelect} className="shrink-0">
      <div
        ref={handleRef}
        role="tab"
        aria-selected={isActive}
        data-tab-id={tab.id}
        tabIndex={tabIndex}
        title={tooltipFor(tab)}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onKeyDown={handleKeyDown}
        className={cn(
          'group relative flex items-center gap-1.5 shrink-0',
          'px-3 py-1.5 text-xs font-medium transition-colors',
          'border-r border-nd-border',
          isActive
            ? 'bg-nd-bg-primary text-nd-text-primary'
            : 'bg-nd-bg-secondary text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-surface'
        )}
      >
        {colorByKind && (
          <span
            aria-hidden
            data-kind-bar
            className={cn('absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r', kindBarClass(tabKind(tab)))}
          />
        )}

        {tab.pinned && <Pin size={11} className="text-nd-text-muted" />}

        <span
          className={cn(
            'truncate',
            tab.pinned ? 'max-w-[80px]' : 'max-w-[160px]',
            (tab.preview || tab.filterScope) && 'italic'
          )}
        >
          {tabTitle(tab)}
        </span>

        {showDatabase && tab.database && <span className="text-2xs text-nd-text-muted">{tab.database}</span>}

        {tab.isDirty && <span aria-label="Unsaved" className="w-1.5 h-1.5 rounded-full bg-nd-warning shrink-0" />}

        {!tab.pinned && (
          <span
            onClick={handleClose}
            className={cn(
              'ml-0.5 p-0.5 rounded-sm shrink-0',
              'opacity-0 group-hover:opacity-100 transition-opacity',
              'hover:bg-nd-surface-hover hover:text-nd-text-primary'
            )}
            role="button"
            aria-label="Close tab"
            tabIndex={-1}
          >
            <X size={12} />
          </span>
        )}

        {isActive && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-nd-accent" />}
      </div>
    </ContextMenu>
  )
})
