import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import { Dropdown } from '@/components/ui/Dropdown'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSFTPPathStore } from '@/stores/sftpPathStore'
import { useUIStore } from '@/stores/uiStore'
import { getSearchContext } from '@/search/context'
import { useSearchCacheStore } from '@/search/cacheClient'
import { sendIntent } from '@/search/intentStore'
import { getSearchSettings, parseGlobList } from '@/search/searchSettings'
import type { PreviewLine, RemoteSearchEvent, TextMatch, TextSearchRequest } from '@/types/search'
import {
  countFiles,
  defaultSearchRoot,
  formatCount,
  groupMatchesByFile,
  splitByRanges,
  type FileHit
} from './textSearchModel'

export interface TextSearchViewProps {
  initialText: string
  onTextChange: (text: string) => void
  onClose: () => void
}

type RunStatus = 'idle' | 'running' | 'done'

interface RunHandle {
  id: string | null
  buffer: RemoteSearchEvent[]
}

interface PreviewState {
  key: string
  lines: PreviewLine[]
}

const SEARCH_DELAY_MS = 250
const PREVIEW_DELAY_MS = 100
const PREVIEW_CONTEXT = 5
const MIN_QUERY_LENGTH = 2
const MAX_MATCHES_LABEL = '2,000'
const TIMEOUT_SECONDS = 20

const FIELD_CLASS =
  'h-[30px] min-w-0 rounded-md border border-nd-border bg-nd-bg-sunken px-2.5 font-mono text-xs text-nd-text-primary placeholder:text-nd-text-dim focus:outline-none focus:border-nd-accent'

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Search failed'
}

function ToggleChip({
  label,
  title,
  pressed,
  onToggle,
  underline
}: {
  label: string
  title: string
  pressed: boolean
  onToggle: () => void
  underline?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={title}
      title={title}
      onClick={onToggle}
      className={cn(
        'inline-flex h-[22px] items-center rounded-md px-2 text-xs font-medium transition-colors',
        pressed ? 'bg-nd-accent/15 text-nd-accent' : 'bg-nd-surface text-nd-text-muted hover:text-nd-text-primary',
        underline && 'underline underline-offset-2'
      )}
    >
      {label}
    </button>
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <span className="rounded border border-nd-border bg-nd-bg-sunken px-1.5 py-px font-mono text-[10.5px] text-nd-text-muted">
      {children}
    </span>
  )
}

function Highlighted({ match }: { match: TextMatch }) {
  return (
    <>
      {splitByRanges(match.text, match.ranges).map((segment, index) =>
        segment.hit ? (
          <mark key={index} className="rounded-[3px] bg-nd-warning/25 px-px text-nd-warning-fg">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  )
}

export function TextSearchView({ initialText, onTextChange, onClose }: TextSearchViewProps) {
  const allTabs = useConnectionStore((s) => s.tabs)
  const activeTabId = useConnectionStore((s) => s.activeTabId)
  const sessions = useSessionStore((s) => s.sessions)
  const sftpPaths = useSFTPPathStore((s) => s.paths)
  const cacheSnapshot = useSearchCacheStore((s) => s.snapshot)

  const sshTabs = useMemo(() => allTabs.filter((t) => t.type !== 'database'), [allTabs])
  const [pickedTabId, setPickedTabId] = useState<string | null>(null)
  const tab = useMemo(
    () =>
      sshTabs.find((t) => t.id === pickedTabId) ??
      sshTabs.find((t) => t.id === activeTabId) ??
      sshTabs[0] ??
      null,
    [sshTabs, pickedTabId, activeTabId]
  )
  const connected = tab?.status === 'connected'

  const [text, setText] = useState(initialText)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [includes, setIncludes] = useState('')
  const [excludes, setExcludes] = useState(() => getSearchSettings().excludeGlobs.join(', '))
  const [rootEdit, setRootEdit] = useState<{ tabId: string; value: string } | null>(null)

  const [matches, setMatches] = useState<TextMatch[]>([])
  const [status, setStatus] = useState<RunStatus>('idle')
  const [truncated, setTruncated] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [stale, setStale] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)

  const runRef = useRef<RunHandle | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const defaultRoot = useMemo(() => {
    if (!tab) return ''
    const sites = cacheSnapshot?.servers[tab.sessionId]?.sites ?? []
    const activeSite = getSearchContext().activeSite
    return defaultSearchRoot({
      sftpPath: sftpPaths[`${tab.sessionId}:remote`],
      siteRoot: activeSite ? sites.find((s) => s.name === activeSite)?.root : undefined,
      defaultDirectory: sessions.find((s) => s.id === tab.sessionId)?.defaultDirectory
    })
  }, [tab, sftpPaths, cacheSnapshot, sessions])

  const root = tab && rootEdit?.tabId === tab.id ? rootEdit.value : defaultRoot
  const query = text.trim()
  const canSearch = connected && query.length >= MIN_QUERY_LENGTH && root.trim().length > 0

  const request = useMemo<TextSearchRequest>(
    () => ({
      connectionId: tab?.id ?? '',
      root: root.trim(),
      text: query,
      caseSensitive,
      wholeWord,
      regex,
      includes: parseGlobList(includes),
      excludes: parseGlobList(excludes)
    }),
    [tab?.id, root, query, caseSensitive, wholeWord, regex, includes, excludes]
  )
  const requestRef = useRef(request)
  requestRef.current = request

  const cancelRun = useCallback(() => {
    const run = runRef.current
    runRef.current = null
    if (run?.id) void window.novadeck.search.cancel(run.id)
  }, [])

  const applyEvent = useCallback((event: RemoteSearchEvent) => {
    if (event.kind === 'text') {
      setMatches((prev) => [...prev, ...event.matches])
      return
    }
    if (event.kind !== 'done') return
    runRef.current = null
    setStatus('done')
    setTruncated(event.truncated)
    setTimedOut(event.timedOut)
    setFailure(event.error ?? null)
  }, [])

  const startSearch = useCallback(() => {
    cancelRun()
    const run: RunHandle = { id: null, buffer: [] }
    runRef.current = run
    setMatches([])
    setSelectedKey(null)
    setPreview(null)
    setTruncated(false)
    setTimedOut(false)
    setFailure(null)
    setStale(false)
    setStatus('running')
    window.novadeck.search
      .findText(requestRef.current)
      .then(({ searchId }) => {
        if (runRef.current !== run) {
          void window.novadeck.search.cancel(searchId)
          return
        }
        run.id = searchId
        const buffered = run.buffer
        run.buffer = []
        buffered.filter((event) => event.searchId === searchId).forEach(applyEvent)
      })
      .catch((error: unknown) => {
        if (runRef.current !== run) return
        runRef.current = null
        setFailure(errorMessage(error))
        setStatus('done')
      })
  }, [applyEvent, cancelRun])

  const stopSearch = useCallback(() => {
    cancelRun()
    setStatus('done')
  }, [cancelRun])

  useEffect(() => {
    const unsubscribe = window.novadeck.search.onEvent((event) => {
      const run = runRef.current
      if (!run) return
      if (run.id === null) {
        run.buffer.push(event)
        return
      }
      if (event.searchId === run.id) applyEvent(event)
    })
    return () => {
      unsubscribe()
    }
  }, [applyEvent])

  useEffect(() => cancelRun, [cancelRun])

  useEffect(() => {
    cancelRun()
    setStale(true)
    setStatus('idle')
    if (!canSearch) {
      setMatches([])
      setSelectedKey(null)
      setPreview(null)
      setTruncated(false)
      setTimedOut(false)
      setFailure(null)
      return
    }
    const timer = setTimeout(startSearch, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [request, canSearch, cancelRun, startSearch])

  const groups = useMemo(() => groupMatchesByFile(matches, request.root), [matches, request.root])
  const hits = useMemo<FileHit[]>(() => groups.flatMap((g) => g.hits), [groups])
  const selectedHit = useMemo(
    () => hits.find((h) => h.key === selectedKey) ?? hits[0] ?? null,
    [hits, selectedKey]
  )
  const activeKey = selectedHit?.key ?? null
  const activePath = selectedHit?.match.path ?? ''
  const activeLine = selectedHit?.match.line ?? 0

  useEffect(() => {
    if (!activeKey || !tab || !connected) {
      setPreview(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      window.novadeck.search
        .preview(tab.id, activePath, activeLine, PREVIEW_CONTEXT)
        .then((lines) => {
          if (!cancelled) setPreview({ key: activeKey, lines })
        })
        .catch(() => {
          if (!cancelled) setPreview({ key: activeKey, lines: [] })
        })
    }, PREVIEW_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activeKey, activePath, activeLine, tab, connected])

  useEffect(() => {
    if (!activeKey) return
    const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [activeKey])

  const changeText = (value: string) => {
    setText(value)
    onTextChange(value)
  }

  const openSelected = (reveal: boolean) => {
    if (!selectedHit || !tab) return
    const path = selectedHit.match.path
    cancelRun()
    sendIntent(
      tab.sessionId,
      reveal ? { kind: 'sftp-reveal', path } : { kind: 'sftp-open', path, line: selectedHit.match.line }
    )
    onClose()
  }

  const moveSelection = (delta: number) => {
    if (hits.length === 0) return
    const current = hits.findIndex((h) => h.key === activeKey)
    const next = Math.min(hits.length - 1, Math.max(0, current + delta))
    setSelectedKey(hits[next].key)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key !== 'Enter') return
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      openSelected(true)
      return
    }
    if (!(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    if (selectedHit && !stale) openSelected(false)
    else if (canSearch) startSearch()
  }

  const connectAndSearch = () => {
    if (tab) useUIStore.getState().requestConnectSession(tab.sessionId)
  }

  const serverItems = sshTabs.map((t) => ({ id: t.id, label: t.sessionName }))

  const statusText = (() => {
    if (!tab) return 'No server is open. Open a server tab to search its files.'
    if (!connected) return `${tab.sessionName} is not connected`
    if (query.length < MIN_QUERY_LENGTH) return `Type at least ${MIN_QUERY_LENGTH} characters to search`
    if (root.trim().length === 0) return 'Enter a folder to search'
    return `${plural(matches.length, 'match', 'matches')} in ${plural(countFiles(matches), 'file', 'files')}`
  })()

  const showCounts = connected && canSearch
  const running = status === 'running'

  return (
    <div role="search" aria-label="Search text in files" onKeyDown={handleKeyDown} className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-nd-border px-4 py-3.5">
        <span className="rounded border border-nd-accent/60 px-2 py-0.5 font-mono text-[13px] text-nd-accent">?</span>
        <input
          autoFocus
          aria-label="Text to find"
          value={text}
          onChange={(e) => changeText(e.target.value)}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-base text-nd-text-primary placeholder:text-nd-text-dim focus:outline-none"
        />
        <ToggleChip label="Aa" title="Match case" pressed={caseSensitive} onToggle={() => setCaseSensitive((v) => !v)} />
        <ToggleChip label="ab" title="Whole word" pressed={wholeWord} onToggle={() => setWholeWord((v) => !v)} underline />
        <ToggleChip label=".*" title="Regular expression" pressed={regex} onToggle={() => setRegex((v) => !v)} />
        <Kbd>esc</Kbd>
      </div>

      <div className="flex flex-col gap-2 border-b border-nd-border px-4 py-2.5">
        <div className="grid grid-cols-[auto_auto_minmax(0,2fr)_auto_minmax(0,1.2fr)_auto_minmax(0,1.4fr)] items-center gap-x-2.5 gap-y-2">
          <span className="text-xs text-nd-text-muted">in</span>
          <Dropdown
            trigger={
              <button
                type="button"
                aria-label="Server"
                className="inline-flex h-[22px] max-w-[160px] items-center gap-1 rounded-md bg-nd-accent/15 px-2 text-xs font-medium text-nd-accent"
              >
                <span className="truncate">{tab?.sessionName ?? 'No server'}</span>
                <ChevronDown size={11} className="shrink-0" />
              </button>
            }
            items={serverItems}
            onSelect={(id) => setPickedTabId(id)}
          />
          <input
            aria-label="Folder"
            title={root}
            value={root}
            placeholder="/var/www/…"
            spellCheck={false}
            onChange={(e) => tab && setRootEdit({ tabId: tab.id, value: e.target.value })}
            className={FIELD_CLASS}
          />
          <span className="text-xs text-nd-text-muted">files</span>
          <input
            aria-label="Files to include"
            title={includes}
            value={includes}
            placeholder="*.php, *.blade.php"
            spellCheck={false}
            onChange={(e) => setIncludes(e.target.value)}
            className={FIELD_CLASS}
          />
          <span className="text-xs text-nd-text-muted">exclude</span>
          <input
            aria-label="Exclude"
            title={excludes}
            value={excludes}
            placeholder="vendor, node_modules"
            spellCheck={false}
            onChange={(e) => setExcludes(e.target.value)}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex items-center gap-2.5 text-xs text-nd-text-muted">
          <span className="flex items-center gap-1.5">
            <span className={cn('inline-block h-[7px] w-[7px] rounded-full', running ? 'bg-nd-accent' : 'bg-nd-text-dim')} />
            <span>{statusText}</span>
            {showCounts && running && <span>· searching…</span>}
            {showCounts && truncated && <span>· stopped at {MAX_MATCHES_LABEL} matches</span>}
            {showCounts && timedOut && <span>· timed out after {TIMEOUT_SECONDS} s</span>}
            {showCounts && failure && <span className="text-nd-error-fg">· {failure}</span>}
          </span>
          <div className="flex-1" />
          {tab && !connected && (
            <button
              type="button"
              onClick={connectAndSearch}
              className="h-7 rounded bg-nd-accent-solid px-2.5 text-xs font-medium text-white hover:bg-nd-accent-solid-hover"
            >
              Connect and search
            </button>
          )}
          {running && (
            <button
              type="button"
              onClick={stopSearch}
              className="h-7 rounded border border-nd-border-hover bg-nd-bg-tertiary px-2.5 text-xs font-medium text-nd-text-primary hover:bg-nd-surface-raised"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      <div className="grid h-[470px] grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div
          ref={listRef}
          role="listbox"
          aria-label="Matches"
          className="overflow-y-auto border-r border-nd-border py-1.5 font-mono text-xs"
        >
          {groups.length === 0 && (
            <div className="px-4 py-6 font-sans text-xs text-nd-text-muted">
              {running ? 'Searching…' : showCounts && !stale ? 'No matches' : 'Results appear here'}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.path}>
              <div className="flex items-center gap-2 px-3.5 pb-1 pt-2 font-sans text-[12.5px]">
                <ChevronRight size={11} className="rotate-90 text-nd-text-muted" />
                <span className="font-medium text-nd-text-primary">{group.name}</span>
                <span className="truncate text-xs text-nd-text-muted">{group.dir}</span>
                <span className="ml-auto rounded bg-nd-surface px-1.5 text-[11px] text-nd-text-muted">{group.hits.length}</span>
              </div>
              {group.hits.map((hit) => (
                <div
                  key={hit.key}
                  role="option"
                  aria-selected={hit.key === activeKey}
                  onClick={() => setSelectedKey(hit.key)}
                  onDoubleClick={() => {
                    setSelectedKey(hit.key)
                    openSelected(false)
                  }}
                  className={cn(
                    'grid cursor-pointer grid-cols-[40px_minmax(0,1fr)] gap-2.5 py-[3px] pl-[30px] pr-3.5',
                    hit.key === activeKey ? 'bg-nd-accent/15' : 'hover:bg-nd-surface/60'
                  )}
                >
                  <span className="text-right text-nd-text-dim">{hit.match.line}</span>
                  <span className="truncate whitespace-nowrap text-nd-text-secondary">
                    <Highlighted match={hit.match} />
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2 border-b border-nd-border px-3.5 py-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-nd-text-primary" title={activePath}>
              {activePath}
            </span>
            <button
              type="button"
              disabled={!selectedHit}
              onClick={() => openSelected(false)}
              className="h-7 shrink-0 rounded border border-nd-border-hover bg-nd-bg-tertiary px-2.5 text-xs font-medium text-nd-text-primary hover:bg-nd-surface-raised disabled:opacity-50"
            >
              Open in editor
            </button>
            <button
              type="button"
              disabled={!selectedHit}
              onClick={() => openSelected(true)}
              className="h-7 shrink-0 rounded border border-nd-border-hover bg-nd-bg-tertiary px-2.5 text-xs font-medium text-nd-text-primary hover:bg-nd-surface-raised disabled:opacity-50"
            >
              Reveal in SFTP
            </button>
          </div>
          <div className="flex-1 overflow-auto bg-nd-bg-sunken py-2 font-mono text-xs leading-[1.75]">
            {preview?.key === activeKey &&
              preview.lines.map((line) => (
                <div
                  key={line.line}
                  className={cn(
                    'grid grid-cols-[40px_minmax(0,1fr)] gap-3 px-3.5',
                    line.line === activeLine && 'bg-nd-accent/15'
                  )}
                >
                  <span className="text-right text-nd-text-dim">{line.line}</span>
                  <span className="whitespace-pre text-nd-text-secondary">{line.text}</span>
                </div>
              ))}
            {!selectedHit && (
              <div className="px-3.5 py-3 font-sans text-xs text-nd-text-muted">Select a match to preview</div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 border-t border-nd-border bg-nd-bg-secondary px-4 py-2.5 text-xs text-nd-text-muted">
        <span>
          Runs <span className="font-mono">rg</span> on the server (falls back to <span className="font-mono">grep -rn</span>),
          read-only, stops at {MAX_MATCHES_LABEL} matches or {TIMEOUT_SECONDS} s
        </span>
        <div className="flex-1" />
        <span>
          <Kbd>↵</Kbd> open at line
        </span>
        <span>
          <Kbd>⌘↵</Kbd> open in SFTP
        </span>
      </div>
    </div>
  )
}
