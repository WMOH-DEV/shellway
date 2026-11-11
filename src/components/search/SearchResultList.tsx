import { useEffect, useRef } from 'react'
import { PROVIDER_SCOPE } from '@/search/useSearch'
import type { ScopeId, ScoredResult } from '@/search/types'
import { VirtualList } from '@/components/ui/VirtualList'
import { cn } from '@/utils/cn'
import type { ListItem, Section } from './searchNavigation'
import { RESULT_VISUALS } from './resultVisuals'

export const LIST_ID = 'search-results'
export const optionId = (rowIndex: number) => `search-option-${rowIndex}`
export const VIRTUAL_ROW_HEIGHT = 40

interface SearchResultListProps {
  items: ListItem[]
  activeIndex: number
  virtual: boolean
  onActivate: (rowIndex: number) => void
  onRun: (result: ScoredResult) => void
  onShowScope: (scope: ScopeId) => void
}

function SectionHeader({ section, virtual, onShowScope }: { section: Section; virtual: boolean; onShowScope: (scope: ScopeId) => void }) {
  const providerId = section.providerId
  return (
    <div
      role="presentation"
      className={cn(
        'flex items-end gap-2 px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-nd-text-muted',
        virtual ? 'h-10' : 'h-8'
      )}
    >
      {section.label}
      {section.overflow > 0 && providerId && (
        <button
          type="button"
          onClick={() => onShowScope(PROVIDER_SCOPE[providerId])}
          className="ml-auto text-xs font-normal normal-case tracking-normal text-nd-text-muted hover:text-nd-text-primary"
        >
          +{section.overflow}
        </button>
      )}
    </div>
  )
}

interface ResultRowProps {
  result: ScoredResult
  rowIndex: number
  active: boolean
  onActivate: (rowIndex: number) => void
  onRun: (result: ScoredResult) => void
}

function ResultRow({ result, rowIndex, active, onActivate, onRun }: ResultRowProps) {
  const { Icon, tone } = RESULT_VISUALS[result.icon]
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  return (
    <div
      ref={ref}
      id={optionId(rowIndex)}
      role="option"
      aria-selected={active}
      onMouseMove={() => !active && onActivate(rowIndex)}
      onClick={() => onRun(result)}
      className={cn(
        'grid h-10 cursor-pointer grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2.5',
        active ? 'bg-nd-accent/15 ring-1 ring-inset ring-nd-accent/40' : 'hover:bg-nd-surface'
      )}
    >
      <span className={cn('flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-nd-surface', tone)}>
        <Icon size={14} />
      </span>
      <span className="flex min-w-0 flex-col leading-[1.3]">
        <span className="truncate text-[13px] text-nd-text-primary">{result.title}</span>
        <span className="truncate text-xs text-nd-text-muted">{result.subtitle}</span>
      </span>
      {result.hint && <span className="text-[11px] text-nd-text-muted">{result.hint}</span>}
    </div>
  )
}

export function SearchResultList({ items, activeIndex, virtual, onActivate, onRun, onShowScope }: SearchResultListProps) {
  const renderItem = (item: ListItem) =>
    item.kind === 'header' ? (
      <SectionHeader section={item.section} virtual={virtual} onShowScope={onShowScope} />
    ) : (
      <ResultRow result={item.result} rowIndex={item.rowIndex} active={item.rowIndex === activeIndex} onActivate={onActivate} onRun={onRun} />
    )

  if (virtual) {
    const activeItemIndex = items.findIndex((i) => i.kind === 'row' && i.rowIndex === activeIndex)
    return (
      <VirtualList
        items={items}
        rowHeight={VIRTUAL_ROW_HEIGHT}
        getKey={(i) => i.key}
        renderRow={renderItem}
        scrollToIndex={activeItemIndex}
        id={LIST_ID}
        role="listbox"
        ariaLabel="Results"
        className="max-h-[min(560px,calc(100vh-280px))] min-h-[420px] px-2 py-1.5"
      />
    )
  }

  return (
    <div id={LIST_ID} role="listbox" aria-label="Results" className="max-h-[min(560px,calc(100vh-280px))] min-h-[420px] overflow-y-auto px-2 py-1.5">
      {items.map((item) => (
        <div key={item.key} role="presentation">{renderItem(item)}</div>
      ))}
    </div>
  )
}
