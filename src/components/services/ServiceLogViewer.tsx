import { useState, useRef, useEffect, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import {
  RefreshCw, ArrowDownToLine, X, Search, ChevronUp, ChevronDown,
  Download, FileText, ArrowUpToLine
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import { TERMINAL_THEMES } from '@/data/terminalThemes'
import type { ServiceLogEntry } from '@/types/serviceManager'

interface ServiceLogViewerProps {
  connectionId: string
  unit: string
  logs: ServiceLogEntry[]
  isLoading: boolean
  onLoadLogs: (lines: number) => void
  onClose: () => void
}

const LINE_COUNT_OPTIONS = [
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '500', label: '500' },
  { value: '1000', label: '1K' },
  { value: '5000', label: '5K' },
  { value: '10000', label: '10K' },
]

/** ANSI escape codes for log priority coloring */
const PRIORITY_ANSI: Record<string, { badge: string; text: string }> = {
  emerg:   { badge: '\x1b[97;41m',  text: '\x1b[91m' },   // white-on-red bg, bright red text
  alert:   { badge: '\x1b[97;41m',  text: '\x1b[91m' },
  crit:    { badge: '\x1b[97;41m',  text: '\x1b[91m' },
  err:     { badge: '\x1b[31m',     text: '\x1b[91m' },    // red badge, bright red text
  warning: { badge: '\x1b[33m',     text: '\x1b[93m' },    // yellow badge, bright yellow text
  notice:  { badge: '\x1b[34m',     text: '\x1b[94m' },    // blue badge, bright blue text
  info:    { badge: '\x1b[90m',     text: '\x1b[37m' },    // dim badge, white text
  debug:   { badge: '\x1b[90m',     text: '\x1b[90m' },    // dim badge, dim text
}

const PRIORITY_LABELS: Record<string, string> = {
  emerg: 'EMERG', alert: 'ALERT', crit: ' CRIT', err: '  ERR',
  warning: ' WARN', notice: ' NOTE', info: ' INFO', debug: 'DEBUG',
}

const RESET = '\x1b[0m'
const DIM = '\x1b[90m'

/**
 * Premium log viewer powered by xterm.js.
 *
 * Features:
 * - GPU-accelerated rendering via WebGL (handles 10K+ lines smoothly)
 * - Native text selection + clipboard copy (Ctrl/Cmd+C)
 * - Built-in search with Ctrl/Cmd+F (find next / find prev)
 * - ANSI-colored log output by priority level
 * - Follow mode (auto-scroll to bottom on new logs)
 * - Scroll-to-top / scroll-to-bottom buttons
 * - Export logs as plain text file
 * - Auto-resizes with container
 */
export function ServiceLogViewer({
  connectionId: _connectionId,
  unit,
  logs,
  isLoading,
  onLoadLogs,
  onClose,
}: ServiceLogViewerProps) {
  const [lineCount, setLineCount] = useState(100)
  const [follow, setFollow] = useState(true)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [matchInfo, setMatchInfo] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const prevLogsRef = useRef<ServiceLogEntry[]>([])
  const followRef = useRef(follow)

  // Keep ref in sync
  useEffect(() => { followRef.current = follow }, [follow])

  // ── Initialize xterm.js ──
  useEffect(() => {
    if (!containerRef.current) return

    const theme = TERMINAL_THEMES['default']

    const terminal = new Terminal({
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: false,
      cursorStyle: 'underline',
      cursorInactiveStyle: 'none',
      scrollback: 50000,
      disableStdin: true,          // read-only log viewer
      convertEol: true,
      allowProposedApi: true,
      theme: {
        ...theme,
        background: '#0c0e14',     // slightly darker than terminal for differentiation
      },
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const webLinksAddon = new WebLinksAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(webLinksAddon)

    terminal.open(containerRef.current)

    // WebGL for GPU-accelerated rendering
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => webglAddon.dispose())
      terminal.loadAddon(webglAddon)
    } catch {
      // Fallback to DOM renderer
    }

    fitAddon.fit()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

    // Ctrl+F / Cmd+F → open search bar
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true

      // Search: Ctrl+F / Cmd+F
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        setShowSearch(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
        return false
      }

      // Copy: Ctrl+C / Cmd+C with selection
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection())
          return false
        }
      }

      // Escape → close search
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false)
        return false
      }

      return true
    })

    // Auto-resize
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || !fitAddonRef.current) return
      const { width, height } = entry.contentRect
      if (width < 10 || height < 10) return
      fitAddonRef.current.fit()
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Write logs to terminal when they change ──
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return

    const prevLogs = prevLogsRef.current

    // Full replacement: clear and rewrite
    if (logs.length === 0) {
      terminal.clear()
      terminal.reset()
      prevLogsRef.current = []
      return
    }

    // Check if this is an append (new logs added to end) or full replace
    const isAppend = prevLogs.length > 0
      && logs.length > prevLogs.length
      && logs[0] === prevLogs[0] // same first entry = append

    if (isAppend) {
      // Only write new entries
      const newEntries = logs.slice(prevLogs.length)
      for (const entry of newEntries) {
        terminal.writeln(formatLogLine(entry))
      }
    } else {
      // Full rewrite
      terminal.clear()
      terminal.reset()

      // Write header
      terminal.writeln(`${DIM}── Journal logs: ${unit} ──${RESET}`)
      terminal.writeln(`${DIM}${logs.length} entries loaded · Select text to copy · Ctrl+F to search${RESET}`)
      terminal.writeln('')

      // Write all entries
      for (const entry of logs) {
        terminal.writeln(formatLogLine(entry))
      }

      terminal.writeln('')
      terminal.writeln(`${DIM}── End of logs ──${RESET}`)
    }

    prevLogsRef.current = logs

    // Auto-scroll to bottom if follow is enabled
    if (followRef.current) {
      terminal.scrollToBottom()
    }
  }, [logs, unit])

  // ── Fit on visibility changes ──
  useEffect(() => {
    // Small delay to let layout settle
    const timer = setTimeout(() => {
      fitAddonRef.current?.fit()
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  // ── Search ──
  const handleSearch = useCallback((direction: 'next' | 'prev') => {
    const addon = searchAddonRef.current
    if (!addon || !searchQuery) return

    const options = { regex: false, wholeWord: false, caseSensitive: false }
    if (direction === 'next') {
      addon.findNext(searchQuery, options)
    } else {
      addon.findPrevious(searchQuery, options)
    }
  }, [searchQuery])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSearch(e.shiftKey ? 'prev' : 'next')
    }
    if (e.key === 'Escape') {
      setShowSearch(false)
      searchAddonRef.current?.clearDecorations()
      terminalRef.current?.focus()
    }
  }, [handleSearch])

  const handleCloseSearch = useCallback(() => {
    setShowSearch(false)
    setSearchQuery('')
    setMatchInfo('')
    searchAddonRef.current?.clearDecorations()
    terminalRef.current?.focus()
  }, [])

  // ── Actions ──
  const handleLineCountChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const count = Number(e.target.value)
      setLineCount(count)
      onLoadLogs(count)
    },
    [onLoadLogs]
  )

  const handleRefresh = useCallback(() => {
    onLoadLogs(lineCount)
  }, [onLoadLogs, lineCount])

  const handleToggleFollow = useCallback(() => {
    setFollow(prev => {
      const next = !prev
      if (next) {
        terminalRef.current?.scrollToBottom()
      }
      return next
    })
  }, [])

  const handleScrollToTop = useCallback(() => {
    terminalRef.current?.scrollToTop()
    setFollow(false)
  }, [])

  const handleScrollToBottom = useCallback(() => {
    terminalRef.current?.scrollToBottom()
  }, [])

  const handleExport = useCallback(() => {
    if (logs.length === 0) return

    const lines = logs.map(entry => {
      const ts = formatTimestampPlain(entry.timestamp)
      const badge = PRIORITY_LABELS[entry.priority]?.trim() || entry.priority.toUpperCase()
      return `[${ts}] [${badge.padEnd(5)}] ${entry.message}`
    })

    const text = lines.join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${unit.replace(/\.service$/, '')}-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported', `${logs.length} log lines saved`)
  }, [logs, unit])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="shrink-0 px-2 py-1.5 bg-nd-bg-secondary border-b border-nd-border flex items-center gap-1.5">
        <FileText size={13} className="text-nd-text-muted shrink-0" />
        <span className="text-xs font-semibold text-nd-text-secondary truncate mr-1">{unit}</span>

        <div className="w-px h-4 bg-nd-border mx-0.5" />

        {/* Line count */}
        <select
          value={String(lineCount)}
          onChange={handleLineCountChange}
          className={cn(
            'h-6 rounded border bg-nd-surface px-1 text-[11px] text-nd-text-primary',
            'border-nd-border appearance-none cursor-pointer',
            'hover:border-nd-border-hover focus:outline-none focus:border-nd-accent'
          )}
          title="Number of log lines to load"
        >
          {LINE_COUNT_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Refresh */}
        <Button
          variant="ghost" size="sm" onClick={handleRefresh}
          disabled={isLoading} className="h-6 w-6 p-0"
          title="Refresh logs"
        >
          <RefreshCw size={12} className={cn(isLoading && 'animate-spin')} />
        </Button>

        <div className="w-px h-4 bg-nd-border mx-0.5" />

        {/* Search toggle */}
        <Button
          variant={showSearch ? 'primary' : 'ghost'} size="sm"
          onClick={() => {
            setShowSearch(s => !s)
            if (!showSearch) setTimeout(() => searchInputRef.current?.focus(), 0)
            else handleCloseSearch()
          }}
          className="h-6 w-6 p-0"
          title="Search (Ctrl+F)"
        >
          <Search size={12} />
        </Button>

        {/* Scroll to top */}
        <Button
          variant="ghost" size="sm" onClick={handleScrollToTop}
          className="h-6 w-6 p-0" title="Scroll to top"
        >
          <ArrowUpToLine size={12} />
        </Button>

        {/* Follow */}
        <Button
          variant={follow ? 'primary' : 'ghost'} size="sm"
          onClick={handleToggleFollow}
          className="h-6 px-2 gap-1"
          title={follow ? 'Auto-scroll ON — click to disable' : 'Auto-scroll OFF — click to enable'}
        >
          <ArrowDownToLine size={12} />
          <span className="text-[10px]">Follow</span>
        </Button>

        <div className="flex-1" />

        {/* Export */}
        <Button
          variant="ghost" size="sm" onClick={handleExport}
          disabled={logs.length === 0}
          className="h-6 w-6 p-0" title="Export logs to file"
        >
          <Download size={12} />
        </Button>

        {/* Close */}
        <Button
          variant="ghost" size="sm" onClick={onClose}
          className="h-6 w-6 p-0" title="Close log viewer"
        >
          <X size={12} />
        </Button>
      </div>

      {/* ── Search bar (conditionally shown) ── */}
      {showSearch && (
        <div className="shrink-0 px-2 py-1.5 bg-nd-bg-secondary/80 border-b border-nd-border flex items-center gap-1.5">
          <Search size={12} className="text-nd-text-muted shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search logs..."
            className="flex-1 h-6 px-2 text-xs bg-nd-bg-primary border border-nd-border rounded text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent/50"
          />
          {matchInfo && (
            <span className="text-[10px] text-nd-text-muted shrink-0">{matchInfo}</span>
          )}
          <Button
            variant="ghost" size="sm" onClick={() => handleSearch('prev')}
            disabled={!searchQuery} className="h-6 w-6 p-0" title="Previous match (Shift+Enter)"
          >
            <ChevronUp size={12} />
          </Button>
          <Button
            variant="ghost" size="sm" onClick={() => handleSearch('next')}
            disabled={!searchQuery} className="h-6 w-6 p-0" title="Next match (Enter)"
          >
            <ChevronDown size={12} />
          </Button>
          <Button
            variant="ghost" size="sm" onClick={handleCloseSearch}
            className="h-6 w-6 p-0" title="Close search (Esc)"
          >
            <X size={12} />
          </Button>
        </div>
      )}

      {/* ── xterm.js container ── */}
      <div className="flex-1 min-h-0 relative">
        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-nd-bg-secondary/90 border border-nd-border">
              <RefreshCw size={14} className="text-nd-accent animate-spin" />
              <span className="text-xs text-nd-text-secondary">Loading logs...</span>
            </div>
          </div>
        )}

        {/* Empty state (shown behind terminal when no logs) */}
        {!isLoading && logs.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center space-y-2">
              <FileText size={28} className="mx-auto text-nd-text-muted opacity-20" />
              <p className="text-xs text-nd-text-muted">No logs available</p>
              <p className="text-[10px] text-nd-text-muted/60">Select a line count and click refresh</p>
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          className="h-full w-full"
          style={{ padding: '4px 0 4px 4px' }}
        />
      </div>

      {/* ── Status bar ── */}
      <div className="shrink-0 px-3 py-1 bg-nd-bg-secondary border-t border-nd-border flex items-center gap-3 text-[10px] text-nd-text-muted">
        <span>{logs.length} lines</span>
        <div className="w-px h-3 bg-nd-border" />
        <span className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />ERR
          </span>
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />WARN
          </span>
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />NOTICE
          </span>
          <span className="flex items-center gap-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 inline-block" />INFO
          </span>
        </span>
        <div className="flex-1" />
        <span className="opacity-60">Ctrl+F search · Select to copy · Ctrl+C copy</span>
      </div>
    </div>
  )
}

// ── Formatting helpers ──

/** Format a log entry as an ANSI-colored terminal line */
function formatLogLine(entry: ServiceLogEntry): string {
  const ts = formatTimestampPlain(entry.timestamp)
  const priority = entry.priority || 'info'
  const ansi = PRIORITY_ANSI[priority] || PRIORITY_ANSI.info
  const label = PRIORITY_LABELS[priority] || priority.toUpperCase().padStart(5)

  // Format: [timestamp] [BADGE] message
  return `${DIM}${ts}${RESET} ${ansi.badge}${label}${RESET} ${ansi.text}${entry.message}${RESET}`
}

/** Plain timestamp for export (no ANSI) */
function formatTimestampPlain(raw: string): string {
  try {
    // journalctl __REALTIME_TIMESTAMP is in microseconds
    const numVal = Number(raw)
    const date = !isNaN(numVal) && numVal > 1e12
      ? new Date(numVal / 1000)   // microseconds → ms
      : new Date(raw)

    if (isNaN(date.getTime())) return raw

    const now = new Date()
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()

    const pad = (n: number) => String(n).padStart(2, '0')
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`

    if (isToday) return time

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${months[date.getMonth()]} ${pad(date.getDate())} ${time}`
  } catch {
    return raw
  }
}
