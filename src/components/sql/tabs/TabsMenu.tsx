import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { VirtualList } from '@/components/ui/VirtualList'
import { useSqlTabSnapshots } from '@/stores/sqlTabSnapshotStore'
import { getBinding } from '@/stores/keybindingStore'
import { formatCombo } from '@/utils/keybindings'
import { cn } from '@/utils/cn'
import type { SQLTab } from '@/types/sql'
import { mruTabs, tabKind } from './tabModel'
import { kindBarClass, kindLabel, relativeTime, tabTitle } from './tabPresentation'
import { scopeCounts, searchTabs, type TabScope } from './tabSearch'
import type { TabActions } from './tabActions'
import { useDatabaseTabs } from './useDatabaseTabs'

interface TabsMenuProps {
  connectionId: string
  actions: TabActions
  open: boolean
  onClose: () => void
  anchorRect?: DOMRect | null
}

const ROW_HEIGHT = 44
const MAX_CLOSED_SHOWN = 5

const SCOPES: { scope: TabScope; label: string }[] = [
  { scope: 'all', label: 'All' },
  { scope: 'tables', label: 'Tables' },
  { scope: 'queries', label: 'Queries' },
  { scope: 'unsaved', label: 'Unsaved' }
]

const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-wider text-nd-text-dim'
const FOOTER_BUTTON = 'h-7 px-2 rounded-md border border-nd-border whitespace-nowrap hover:bg-nd-surface-hover'

function panelPosition(anchorRect: DOMRect | null | undefined): { className: string; style: CSSProperties } {
  if (!anchorRect) return { className: 'left-1/2 -translate-x-1/2', style: { top: 64 } }
  return { className: '', style: { top: anchorRect.bottom + 4, right: window.innerWidth - anchorRect.right } }
}

function metaLine(tab: SQLTab, filterSummary: string | undefined): string {
  return [tab.database, kindLabel(tabKind(tab)), filterSummary ? `filter: ${filterSummary}` : undefined]
    .filter(Boolean)
    .join(' · ')
}

function closedAgo(closedAt: number): string {
  const elapsed = relativeTime(closedAt, Date.now())
  return elapsed === 'now' ? elapsed : `${elapsed} ago`
}

interface TabRowProps {
  tab: SQLTab
  optionId: string
  isHighlighted: boolean
  filterSummary: string | undefined
  onHover: () => void
  onActivate: () => void
  onClose: () => void
}

function TabRow({ tab, optionId, isHighlighted, filterSummary, onHover, onActivate, onClose }: TabRowProps) {
  return (
    <div
      id={optionId}
      role="option"
      aria-selected={isHighlighted}
      onMouseMove={onHover}
      onClick={onActivate}
      className={cn('flex items-center gap-2 h-full px-2 rounded-md cursor-pointer', isHighlighted && 'bg-nd-surface-hover')}
    >
      <span className={cn('w-[3px] h-6 rounded-full shrink-0', kindBarClass(tabKind(tab)))} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('text-nd-text-primary truncate', tab.preview && 'italic')}>{tabTitle(tab)}</span>
        <span className="text-nd-text-muted truncate">{metaLine(tab, filterSummary)}</span>
      </span>
      <span className="shrink-0 text-nd-text-muted">{relativeTime(tab.lastActiveAt, Date.now())}</span>
      {!tab.pinned && (
        <button
          type="button"
          aria-label="Close tab"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="shrink-0 rounded p-1 text-nd-text-muted hover:bg-nd-surface-raised hover:text-nd-text-primary"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

function TabsMenuPanel({ connectionId, actions, onClose, anchorRect }: Omit<TabsMenuProps, 'open'>) {
  const tabsState = useDatabaseTabs(connectionId)
  const { tabs, activeTabId, closed: closedTabs } = tabsState
  const snapshots = useSqlTabSnapshots()
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<TabScope>('all')
  const [highlight, setHighlight] = useState(0)

  const counts = useMemo(() => scopeCounts(tabs), [tabs])
  const filterTextById = useMemo(
    () => Object.fromEntries(Object.entries(snapshots).map(([id, snapshot]) => [id, snapshot.filterSummary])),
    [snapshots]
  )
  const results = useMemo(
    () => searchTabs(mruTabs(tabsState), query, scope, filterTextById),
    [tabsState, query, scope, filterTextById]
  )

  const highlightedIndex = Math.min(highlight, Math.max(0, results.length - 1))
  const highlighted: SQLTab | undefined = results[highlightedIndex]
  const unpinnedIds = tabs.filter((t) => !t.pinned).map((t) => t.id)
  const position = panelPosition(anchorRect)

  const activate = (id: string) => {
    actions.activate(id)
    onClose()
  }

  const changeQuery = (value: string) => {
    setQuery(value)
    setHighlight(0)
  }

  const changeScope = (next: TabScope) => {
    setScope(next)
    setHighlight(0)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(Math.min(highlightedIndex + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(Math.max(highlightedIndex - 1, 0))
    } else if (e.key === 'Enter' && highlighted) {
      e.preventDefault()
      activate(highlighted.id)
    } else if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Backspace' && query === '' && highlighted && !highlighted.pinned) {
      e.preventDefault()
      actions.close(highlighted.id)
      setHighlight(highlightedIndex)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        className={cn(
          'fixed z-50 w-[420px] rounded-lg border border-nd-border bg-nd-surface shadow-xl flex flex-col max-h-[70vh] text-xs',
          position.className
        )}
        style={position.style}
      >
        <div className="flex items-center justify-between px-3 pt-3">
          <span className="font-medium text-nd-text-primary">Go to tab</span>
          <kbd className="rounded border border-nd-border px-1 font-mono text-[11px] text-nd-text-muted">
            {formatCombo(getBinding('sql:tabMenu'))}
          </kbd>
        </div>

        <div className="px-3 pt-2">
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-activedescendant={highlighted ? `${listboxId}-${highlighted.id}` : undefined}
            aria-label="Search open tabs"
            placeholder="Search open tabs"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-8 w-full px-2 rounded-md border border-nd-border bg-nd-bg-sunken outline-none focus:border-nd-accent"
          />
        </div>

        <div className="flex gap-1 px-3 pt-2">
          {SCOPES.map(({ scope: chipScope, label }) => (
            <button
              key={chipScope}
              type="button"
              aria-pressed={scope === chipScope}
              onClick={() => changeScope(chipScope)}
              className={cn(
                'h-6 px-2 rounded-md',
                scope === chipScope
                  ? 'bg-nd-surface-raised text-nd-text-primary'
                  : 'text-nd-text-muted hover:text-nd-text-secondary'
              )}
            >
              {`${label} ${counts[chipScope]}`}
            </button>
          ))}
        </div>

        <div className={cn(SECTION_LABEL, 'px-3 pt-3 pb-1')}>Matches</div>
        <div className="min-h-0 px-1">
          {results.length === 0 ? (
            <div className="px-2 py-3 text-nd-text-muted">No open tabs match</div>
          ) : (
            <VirtualList
              items={results}
              rowHeight={ROW_HEIGHT}
              id={listboxId}
              role="listbox"
              ariaLabel="Open tabs"
              scrollToIndex={highlightedIndex}
              className="max-h-[264px] min-h-0"
              getKey={(tab) => tab.id}
              renderRow={(tab, index) => (
                <TabRow
                  tab={tab}
                  optionId={`${listboxId}-${tab.id}`}
                  isHighlighted={index === highlightedIndex}
                  filterSummary={snapshots[tab.id]?.filterSummary}
                  onHover={() => setHighlight(index)}
                  onActivate={() => activate(tab.id)}
                  onClose={() => actions.close(tab.id)}
                />
              )}
            />
          )}
        </div>

        {closedTabs.length > 0 && (
          <>
            <div className={cn(SECTION_LABEL, 'px-3 pt-3 pb-1')}>Recently closed</div>
            <div className="px-1">
              {closedTabs.slice(0, MAX_CLOSED_SHOWN).map((entry, index) => (
                <button
                  key={`${entry.tab.id}-${entry.closedAt}`}
                  type="button"
                  onClick={() => {
                    actions.reopenClosed(index)
                    onClose()
                  }}
                  className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-nd-text-secondary hover:bg-nd-surface-hover"
                >
                  <RotateCcw size={12} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{tabTitle(entry.tab)}</span>
                  <span className="shrink-0 text-nd-text-muted">{closedAgo(entry.closedAt)}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-2 flex items-center gap-1.5 border-t border-nd-border px-3 py-2">
          <button
            type="button"
            className={FOOTER_BUTTON}
            onClick={() => actions.closeMany(unpinnedIds.filter((id) => id !== activeTabId))}
          >
            Close others
          </button>
          <button type="button" className={FOOTER_BUTTON} onClick={() => actions.closeMany(unpinnedIds)}>
            Close unpinned
          </button>
          <button type="button" className={FOOTER_BUTTON} onClick={() => actions.sortByName()}>
            Sort A–Z
          </button>
          <span className="ml-auto whitespace-pre text-nd-text-muted">↑↓ move  ↵ open</span>
        </div>
      </div>
    </>
  )
}

export function TabsMenu({ open, ...panelProps }: TabsMenuProps) {
  if (!open) return null
  return <TabsMenuPanel {...panelProps} />
}
