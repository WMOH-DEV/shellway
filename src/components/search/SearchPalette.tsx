import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plug, Search } from 'lucide-react'
import { Dropdown } from '@/components/ui/Dropdown'
import { toast } from '@/components/ui/Toast'
import { useConnectionStore } from '@/stores/connectionStore'
import { useUIStore } from '@/stores/uiStore'
import { recordSelection } from '@/search/cacheClient'
import { PREFIX_LABELS } from '@/search/queryParser'
import { useSearchSettingsStore } from '@/search/searchSettings'
import type { ScopeId, ScoredResult, SearchAction, SearchPrefix, ServerFilter } from '@/search/types'
import { useSearch } from '@/search/useSearch'
import { cn } from '@/utils/cn'
import { SearchPreview } from './SearchPreview'
import { LIST_ID, optionId, SearchResultList } from './SearchResultList'
import { TextSearchView } from './TextSearchView'
import { buildListItems, buildSections, sectionRows, stepGroup, wrapIndex } from './searchNavigation'

const CHIPS: { scope: ScopeId; label: string }[] = [
  { scope: 'all', label: 'All' },
  { scope: 'tables', label: 'Tables' },
  { scope: 'queries', label: 'Queries' },
  { scope: 'files', label: 'Files' },
  { scope: 'commands', label: 'Commands' },
  { scope: 'sites', label: 'Sites' },
  { scope: 'history', label: 'History' },
  { scope: 'settings', label: 'Settings' }
]

const PREFIXES: SearchPrefix[] = ['>', '@', '#', '/', '?']
const VIRTUAL_THRESHOLD = 50
const SERVER_FILTER_ITEMS = [
  { id: 'current', label: 'Current server' },
  { id: 'all', label: 'All servers' }
]

const kbdClass = 'rounded border border-nd-border bg-nd-bg-primary px-1.5 font-mono text-[10.5px] text-nd-text-muted'

function findAction(actions: SearchAction[], role: SearchAction['role']): SearchAction | undefined {
  return actions.find((a) => a.role === role)
}

function hasTextSelection(input: HTMLInputElement | null): boolean {
  if (input && input.selectionStart !== input.selectionEnd) return true
  return (window.getSelection()?.toString() ?? '') !== ''
}

function resultsLabel(total: number, elapsedMs: number | null): string {
  const noun = total === 1 ? 'result' : 'results'
  return elapsedMs === null ? `${total} ${noun}` : `${total} ${noun} · ${elapsedMs} ms`
}

export function SearchPalette() {
  const open = useUIStore((s) => s.searchOpen)
  return open ? <PaletteDialog /> : null
}

function PaletteDialog() {
  const closeSearch = useUIStore((s) => s.closeSearch)
  const search = useSearch(true)
  const { input, setInput, chipScope, setChipScope, serverFilter, setServerFilter, grouped, scopeCounts, elapsedMs, loading, remoteCommand, parsed, actionsFor } = search
  const disabledScopes = useSearchSettingsStore((s) => s.disabledScopes)
  const activeTab = useConnectionStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const [activeId, setActiveId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const isTextMode = parsed.prefix === '?'

  const sections = useMemo(() => buildSections(grouped), [grouped])
  const rows = useMemo(() => sectionRows(sections), [sections])
  const items = useMemo(() => buildListItems(sections), [sections])
  const activeIndex = Math.max(0, rows.findIndex((r) => r.id === activeId))
  const active = rows[activeIndex] ?? null
  const actions = useMemo(() => (active ? actionsFor(active) : []), [active, actionsFor])
  const isVirtual = chipScope !== 'all' && rows.length > VIRTUAL_THRESHOLD

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    if (!isTextMode) inputRef.current?.focus()
    else if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.querySelector('input')?.focus()
  }, [isTextMode])

  useEffect(() => {
    setActiveId(null)
  }, [input, chipScope, serverFilter])

  const runAction = useCallback(
    (result: ScoredResult, action: SearchAction) => {
      recordSelection(result, parsed.text)
      closeSearch()
      window.setTimeout(() => {
        Promise.resolve()
          .then(() => action.run())
          .catch((err: unknown) => toast.error('Action failed', String(err)))
      }, 0)
    },
    [parsed.text, closeSearch]
  )

  const runPrimaryFor = useCallback(
    (result: ScoredResult) => {
      const action = findAction(actionsFor(result), 'primary')
      if (action) runAction(result, action)
    },
    [actionsFor, runAction]
  )

  const moveTo = useCallback(
    (index: number) => setActiveId(rows[index]?.id ?? null),
    [rows]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isTextMode || e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSearch()
      return
    }
    const hasModifier = e.metaKey || e.ctrlKey
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      moveTo(wrapIndex(rows.length, activeIndex, e.key === 'ArrowDown' ? 1 : -1))
    } else if (e.key === 'Tab') {
      e.preventDefault()
      moveTo(stepGroup(sections, activeIndex, e.shiftKey ? -1 : 1))
    } else if (e.key === 'Enter' && active) {
      e.preventDefault()
      const action = findAction(actions, hasModifier ? 'secondary' : 'primary')
      if (action) runAction(active, action)
    } else if (hasModifier && !e.shiftKey && e.key.toLowerCase() === 'c' && active && !hasTextSelection(inputRef.current)) {
      const action = findAction(actions, 'copy')
      if (!action) return
      e.preventDefault()
      runAction(active, action)
    }
  }

  const insertPrefix = (prefix: SearchPrefix) => {
    setInput(prefix + parsed.text)
    inputRef.current?.focus()
  }

  const connectAndSearch = () => {
    if (!activeTab) return
    useUIStore.getState().requestConnectSession(activeTab.sessionId)
    closeSearch()
  }

  const needsConnection =
    parsed.scope === 'files' && serverFilter === 'current' && activeTab?.type !== 'database' && (activeTab?.status === 'disconnected' || activeTab?.status === 'error')
  const isEmptyQuery = parsed.text === '' && !parsed.prefix

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-center bg-[rgba(4,6,10,0.66)] pt-16"
      onMouseDown={(e) => e.target === e.currentTarget && closeSearch()}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={isTextMode ? 'Search text in files' : 'Search everything'}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex max-w-[calc(100vw-32px)] flex-col self-start overflow-hidden outline-none rounded-[14px] border border-nd-border bg-nd-bg-secondary shadow-2xl',
          isTextMode ? 'w-[1040px]' : 'w-[860px]'
        )}
      >
        {isTextMode ? (
          <TextSearchView initialText={parsed.text} onTextChange={(text) => setInput(`?${text}`)} onClose={closeSearch} />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-nd-border px-4 py-3.5">
              <Search size={18} className="shrink-0 text-nd-accent" />
              <input
                ref={inputRef}
                autoFocus
                role="combobox"
                aria-label="Search everything"
                aria-expanded
                aria-controls={LIST_ID}
                aria-activedescendant={active ? optionId(activeIndex) : undefined}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search servers, tables, files, commands…"
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-[17px] text-nd-text-primary outline-none placeholder:text-nd-text-dim"
              />
              <span className="shrink-0 text-xs text-nd-text-muted">{resultsLabel(grouped.total, elapsedMs)}</span>
              <kbd className={kbdClass}>esc</kbd>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-b border-nd-border px-4 py-2.5">
              {CHIPS.filter((c) => c.scope === 'all' || !disabledScopes.includes(c.scope)).map((chip) => {
                const selected = parsed.scope === chip.scope
                const count = scopeCounts[chip.scope]
                return (
                  <button
                    key={chip.scope}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setChipScope(chip.scope)
                      inputRef.current?.focus()
                    }}
                    className={cn(
                      'inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors',
                      selected
                        ? 'bg-nd-accent/15 text-nd-text-primary ring-1 ring-inset ring-nd-accent/50'
                        : 'bg-nd-surface text-nd-text-secondary hover:bg-nd-surface-hover'
                    )}
                  >
                    {chip.label}
                    {(count > 0 || selected) && <span className="opacity-70">{count}</span>}
                  </button>
                )
              })}
              <div className="flex-1" />
              <Dropdown
                align="right"
                items={SERVER_FILTER_ITEMS}
                onSelect={(id) => setServerFilter(id as ServerFilter)}
                trigger={
                  <button
                    type="button"
                    className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md bg-nd-surface px-2 text-xs font-medium text-nd-text-secondary hover:bg-nd-surface-hover"
                  >
                    {activeTab?.sessionName ?? 'No server'} · {serverFilter === 'current' ? 'current' : 'all servers'}
                    <ChevronDown size={11} />
                  </button>
                }
              />
            </div>

            <div className="grid min-h-[470px] grid-cols-[minmax(0,1fr)_300px]">
              <div className="flex min-w-0 flex-col border-r border-nd-border">
                {rows.length > 0 ? (
                  <SearchResultList
                    items={items}
                    activeIndex={activeIndex}
                    virtual={isVirtual}
                    onActivate={moveTo}
                    onRun={runPrimaryFor}
                    onShowScope={setChipScope}
                  />
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-nd-text-muted">
                    {isEmptyQuery ? (
                      <>
                        <span>Search servers, tables, saved queries, files, commands and settings.</span>
                        <span className="text-xs">Start with a prefix to narrow it down.</span>
                      </>
                    ) : (
                      !loading && !needsConnection && <span>{`No results for "${parsed.text}"`}</span>
                    )}
                  </div>
                )}
                {needsConnection && (
                  <button
                    type="button"
                    onClick={connectAndSearch}
                    className="mx-2 mb-2 flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] text-nd-text-primary hover:bg-nd-surface"
                  >
                    <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-nd-surface text-nd-accent">
                      <Plug size={14} />
                    </span>
                    Connect and search
                  </button>
                )}
              </div>
              <SearchPreview result={active} actions={actions} onRun={(action) => active && runAction(active, action)} />
            </div>

            <div className="flex items-center gap-4 border-t border-nd-border bg-nd-bg-sunken px-4 py-2.5 text-xs text-nd-text-muted">
              {PREFIXES.map((prefix) => (
                <button key={prefix} type="button" onClick={() => insertPrefix(prefix)} className="flex shrink-0 items-center gap-1 hover:text-nd-text-primary">
                  <kbd className={kbdClass}>{prefix}</kbd> {PREFIX_LABELS[prefix]}
                </button>
              ))}
              <span className="min-w-0 flex-1 truncate text-right">{remoteCommand && `Runs ${remoteCommand}, read-only`}</span>
              <span className="shrink-0"><kbd className={kbdClass}>↑↓</kbd> move</span>
              <span className="shrink-0"><kbd className={kbdClass}>tab</kbd> next group</span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
