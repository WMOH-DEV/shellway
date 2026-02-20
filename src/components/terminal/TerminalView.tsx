import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { cn } from '@/utils/cn'

interface TerminalViewProps {
  /** Unique ID for this shell */
  shellId: string
  /** Connection ID this terminal belongs to */
  connectionId: string
  /** Current SSH connection status — shell only opens when 'connected' */
  connectionStatus?: string
  /** Whether this terminal is the active/visible one */
  isActive: boolean
  /** Font family */
  fontFamily?: string
  /** Font size */
  fontSize?: number
  /** Callback when terminal is ready (for search addon) */
  onSearchAddon?: (addon: SearchAddon) => void
  /** Callback when user presses Ctrl+F in terminal */
  onSearchRequest?: () => void
  /** Register a clear function for this terminal */
  onClearHandler?: (clearFn: () => void) => void
  className?: string
}

/**
 * xterm.js terminal wrapper with fit, web-links, and search addons.
 * Connects to a remote shell via IPC.
 */
export function TerminalView({
  shellId,
  connectionId,
  connectionStatus,
  isActive,
  fontFamily = 'JetBrains Mono, Fira Code, Consolas, monospace',
  fontSize = 14,
  onSearchAddon,
  onSearchRequest,
  onClearHandler,
  className
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const onSearchRequestRef = useRef(onSearchRequest)
  const [isReady, setIsReady] = useState(false)

  // Keep ref in sync
  useEffect(() => {
    onSearchRequestRef.current = onSearchRequest
  }, [onSearchRequest])

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return

    const terminal = new Terminal({
      fontFamily,
      fontSize,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowProposedApi: true,
      theme: {
        background: '#0f1117',
        foreground: '#e4e4e7',
        cursor: '#e4e4e7',
        cursorAccent: '#0f1117',
        selectionBackground: '#3b82f640',
        selectionForeground: '#e4e4e7',
        black: '#1e2130',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e4e4e7',
        brightBlack: '#71717a',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff'
      }
    })

    // Addons
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const searchAddon = new SearchAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.loadAddon(searchAddon)

    terminal.open(containerRef.current)
    fitAddon.fit()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    if (onSearchAddon) {
      onSearchAddon(searchAddon)
    }

    if (onClearHandler) {
      onClearHandler(() => {
        terminal.clear()
      })
    }

    // Forward terminal input to main process via IPC
    terminal.onData((data) => {
      window.novadeck.terminal.write(shellId, data)
    })

    // Listen for shell output from main process
    const unsubData = window.novadeck.terminal.onData((id, data) => {
      if (id === shellId) {
        terminal.write(data)
      }
    })

    const unsubExit = window.novadeck.terminal.onExit((id, _code) => {
      if (id === shellId) {
        terminal.write('\r\n\x1b[33m[Session ended]\x1b[0m\r\n')
      }
    })

    // Handle resize — guard against hidden (display:none) container
    // When the terminal is hidden, the container has 0x0 dimensions.
    // Calling fit() at that point would shrink the terminal to 0 rows and truncate the scrollback buffer.
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry || !fitAddonRef.current) return
      const { width, height } = entry.contentRect
      // Skip fit when the container is effectively invisible
      if (width < 10 || height < 10) return
      fitAddonRef.current.fit()
      const { cols, rows } = terminal
      window.novadeck.terminal.resize(shellId, cols, rows)
    })
    resizeObserver.observe(containerRef.current)

    // ── Keyboard shortcuts: Ctrl+F search, Ctrl+C/V clipboard ──
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Search: Ctrl+F opens search bar
      if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        onSearchRequestRef.current?.()
        return false // Prevent default browser find
      }

      // Copy: Ctrl+Shift+C, or Ctrl+C when text is selected
      if (e.type === 'keydown' && e.ctrlKey && (e.key === 'C' || e.key === 'c')) {
        const hasSelection = terminal.hasSelection()
        if (e.shiftKey || hasSelection) {
          if (hasSelection) {
            navigator.clipboard.writeText(terminal.getSelection())
          }
          return false // Prevent xterm from sending Ctrl+C to shell
        }
        // No selection + no shift → let xterm send SIGINT as usual
        return true
      }

      // Paste: Ctrl+Shift+V or Ctrl+V
      if (e.type === 'keydown' && e.ctrlKey && (e.key === 'V' || e.key === 'v')) {
        navigator.clipboard.readText().then((text) => {
          if (text) terminal.paste(text)
        })
        return false
      }

      return true
    })

    return () => {
      unsubData()
      unsubExit()
      resizeObserver.disconnect()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [shellId, connectionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Open shell when connection is ready
  useEffect(() => {
    if (connectionStatus !== 'connected' || !terminalRef.current || isReady) return

    const terminal = terminalRef.current
    const openShell = async () => {
      const { cols, rows } = terminal
      const result = await window.novadeck.terminal.open(connectionId, shellId, { cols, rows })
      if (!result.success) {
        terminal.write(`\x1b[31mFailed to open shell: ${result.error}\x1b[0m\r\n`)
      }
      setIsReady(true)
    }
    openShell()
  }, [connectionStatus, connectionId, shellId, isReady])

  // Re-fit when becoming active — wait for the container to be visible before fitting
  useEffect(() => {
    if (!isActive || !fitAddonRef.current || !terminalRef.current || !containerRef.current) return

    // Wait a frame for `hidden` class removal + layout reflow, then fit & focus.
    // The 50ms delay covers edge cases where layout hasn't fully settled.
    const timer = setTimeout(() => {
      requestAnimationFrame(() => {
        const el = containerRef.current
        if (!el || el.offsetWidth < 10 || el.offsetHeight < 10) return
        fitAddonRef.current?.fit()
        terminalRef.current?.focus()
      })
    }, 50)
    return () => clearTimeout(timer)
  }, [isActive])

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-full w-full bg-nd-bg-primary',
        className
      )}
    />
  )
}
