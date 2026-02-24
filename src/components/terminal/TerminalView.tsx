import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { cn } from '@/utils/cn'
import { TERMINAL_THEMES } from '@/data/terminalThemes'
import { findSnippetByShortcut } from '@/stores/snippetStore'
import { matchesBinding } from '@/stores/keybindingStore'
import type { ResolvedTerminalSettings } from '@/utils/resolveSettings'

interface TerminalViewProps {
  /** Unique ID for this shell */
  shellId: string
  /** Connection ID this terminal belongs to */
  connectionId: string
  /** Current SSH connection status — shell only opens when 'connected' */
  connectionStatus?: string
  /** Whether this terminal is the active/visible one */
  isActive: boolean
  /** Resolved terminal settings (global + session overrides) */
  terminalSettings?: ResolvedTerminalSettings
  /** Callback when terminal is ready (for search addon) */
  onSearchAddon?: (addon: SearchAddon) => void
  /** Callback when user presses Ctrl+F in terminal */
  onSearchRequest?: () => void
  /** Register a clear function for this terminal */
  onClearHandler?: (clearFn: () => void) => void
  /** Callback when user presses Ctrl+Shift+S to open snippet palette */
  onSnippetPaletteRequest?: () => void
  /** Register a focus function so parent can re-focus this terminal */
  onFocusHandler?: (focusFn: () => void) => void
  /** Register a paste function so parent can insert text through xterm's onData flow */
  onPasteHandler?: (pasteFn: (text: string) => void) => void
  className?: string
}

/**
 * xterm.js terminal wrapper with fit, web-links, and search addons.
 * Connects to a remote shell via IPC.
 */
// Hardcoded defaults used when no settings are provided
const DEFAULTS = {
  fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
  fontSize: 14,
  lineHeight: 1.4,
  cursorBlink: true,
  cursorStyle: 'block' as const,
  scrollback: 10000,
  copyOnSelect: false,
  rightClickPaste: false,
  bellBehavior: 'none' as const
}

export function TerminalView({
  shellId,
  connectionId,
  connectionStatus,
  isActive,
  terminalSettings,
  onSearchAddon,
  onSearchRequest,
  onClearHandler,
  onSnippetPaletteRequest,
  onFocusHandler,
  onPasteHandler,
  className
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const onSearchRequestRef = useRef(onSearchRequest)
  const onSnippetPaletteRequestRef = useRef(onSnippetPaletteRequest)
  const [isReady, setIsReady] = useState(false)

  // Keep refs in sync
  useEffect(() => {
    onSearchRequestRef.current = onSearchRequest
  }, [onSearchRequest])

  useEffect(() => {
    onSnippetPaletteRequestRef.current = onSnippetPaletteRequest
  }, [onSnippetPaletteRequest])

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return

    const fontFamily = terminalSettings?.fontFamily ?? DEFAULTS.fontFamily
    const fontSize = terminalSettings?.fontSize ?? DEFAULTS.fontSize
    const lineHeight = terminalSettings?.lineHeight ?? DEFAULTS.lineHeight
    const cursorBlink = terminalSettings?.cursorBlink ?? DEFAULTS.cursorBlink
    const cursorStyle = terminalSettings?.cursorStyle ?? DEFAULTS.cursorStyle
    const scrollback = terminalSettings?.scrollbackLines ?? DEFAULTS.scrollback
    const copyOnSelect = terminalSettings?.copyOnSelect ?? DEFAULTS.copyOnSelect
    const rightClickPaste = terminalSettings?.rightClickPaste ?? DEFAULTS.rightClickPaste
    const bellBehavior = terminalSettings?.bellBehavior ?? DEFAULTS.bellBehavior

    const terminal = new Terminal({
      fontFamily,
      fontSize,
      lineHeight,
      cursorBlink,
      cursorStyle,
      scrollback,
      allowProposedApi: true,
      theme: TERMINAL_THEMES[terminalSettings?.colorScheme ?? 'default'] ?? TERMINAL_THEMES['default']
    })

    // Addons
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const searchAddon = new SearchAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.loadAddon(searchAddon)

    terminal.open(containerRef.current)

    // Use WebGL renderer for significantly better performance.
    // Falls back to the default DOM renderer if WebGL is unavailable.
    try {
      const webglAddon = new WebglAddon()
      // Dispose WebGL addon gracefully if it loses context (e.g. GPU driver reset)
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      terminal.loadAddon(webglAddon)
    } catch {
      // WebGL not available — DOM renderer is used automatically
    }

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

    if (onFocusHandler) {
      onFocusHandler(() => {
        terminal.focus()
      })
    }

    if (onPasteHandler) {
      onPasteHandler((text: string) => {
        terminal.paste(text)
      })
    }

    // Buffer to track the current word for snippet expansion
    const inputBuffer = { current: '' }

    // Forward terminal input to main process via IPC (with snippet expansion)
    terminal.onData((data) => {
      // Tab — check for snippet expansion
      if (data === '\t') {
        const word = inputBuffer.current
        if (word.length > 0) {
          const snippet = findSnippetByShortcut(word)
          if (snippet) {
            // Erase the shortcut from the remote shell by sending backspaces.
            // NOTE: \x7f (DEL) works as backspace on most modern shells with xterm-256color TERM,
            // but may not work on some legacy shells or unusual TERM configurations.
            const eraseSeq = '\x7f'.repeat(word.length)
            window.novadeck.terminal.write(shellId, eraseSeq)
            // Send the expanded command
            window.novadeck.terminal.write(shellId, snippet.command)
            inputBuffer.current = ''
            return // Don't send the Tab
          }
        }
        // No match — pass Tab through for shell completion
        window.novadeck.terminal.write(shellId, data)
        inputBuffer.current = ''
        return
      }

      // Enter, Ctrl+C, Ctrl+U — reset buffer
      if (data === '\r' || data === '\x03' || data === '\x15') {
        inputBuffer.current = ''
        window.novadeck.terminal.write(shellId, data)
        return
      }

      // Backspace — remove last char from buffer
      if (data === '\x7f' || data === '\b') {
        inputBuffer.current = inputBuffer.current.slice(0, -1)
        window.novadeck.terminal.write(shellId, data)
        return
      }

      // Space — reset the word buffer (we only track the current word)
      if (data === ' ') {
        inputBuffer.current = ''
        window.novadeck.terminal.write(shellId, data)
        return
      }

      // Printable single characters — append to buffer
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        inputBuffer.current += data
        window.novadeck.terminal.write(shellId, data)
        return
      }

      // Multi-char data (paste, escape sequences, etc.) — reset buffer and pass through
      inputBuffer.current = ''
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

    // ── Keyboard shortcuts (customizable bindings + hardcoded copy/paste) ──
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true

      // Search: customizable (default Ctrl+F)
      if (matchesBinding(e, 'terminal:search')) {
        onSearchRequestRef.current?.()
        return false
      }

      // Copy: Ctrl+Shift+C, or Ctrl+C when text is selected (hardcoded — universal)
      if (e.ctrlKey && (e.key === 'C' || e.key === 'c')) {
        const hasSelection = terminal.hasSelection()
        if (e.shiftKey || hasSelection) {
          if (hasSelection) {
            navigator.clipboard.writeText(terminal.getSelection())
          }
          return false
        }
        return true
      }

      // Paste: Ctrl+Shift+V or Ctrl+V (hardcoded — universal)
      if (e.ctrlKey && (e.key === 'V' || e.key === 'v')) {
        navigator.clipboard.readText().then((text) => {
          if (text) terminal.paste(text)
        })
        return false
      }

      // Snippet palette: customizable (default CmdOrCtrl+Shift+S)
      if (matchesBinding(e, 'terminal:snippetPalette')) {
        onSnippetPaletteRequestRef.current?.()
        return false
      }

      return true
    })

    // ── Copy on select ──
    let unsubSelection: (() => void) | undefined
    if (copyOnSelect) {
      const disposable = terminal.onSelectionChange(() => {
        const sel = terminal.getSelection()
        if (sel) {
          navigator.clipboard.writeText(sel)
        }
      })
      unsubSelection = () => disposable.dispose()
    }

    // ── Right-click paste ──
    const handleContextMenu = (e: MouseEvent) => {
      if (!rightClickPaste) return
      e.preventDefault()
      navigator.clipboard.readText().then((text) => {
        if (text) terminal.paste(text)
      })
    }
    containerRef.current.addEventListener('contextmenu', handleContextMenu)

    // ── Bell behavior ──
    // Reuse a single AudioContext to avoid resource leaks (browsers cap at ~6)
    let audioCtx: AudioContext | null = null
    const bellDisposable = terminal.onBell(() => {
      if (bellBehavior === 'sound') {
        try {
          if (!audioCtx) audioCtx = new AudioContext()
          const osc = audioCtx.createOscillator()
          const gain = audioCtx.createGain()
          osc.connect(gain)
          gain.connect(audioCtx.destination)
          osc.frequency.value = 800
          gain.gain.value = 0.1
          osc.start()
          osc.stop(audioCtx.currentTime + 0.1)
        } catch {
          // Audio not available — ignore silently
        }
      } else if (bellBehavior === 'visual') {
        const el = containerRef.current
        if (el) {
          el.style.filter = 'brightness(1.5)'
          setTimeout(() => { el.style.filter = '' }, 150)
        }
      }
    })

    return () => {
      unsubData()
      unsubExit()
      unsubSelection?.()
      bellDisposable.dispose()
      audioCtx?.close().catch(() => {})
      containerRef.current?.removeEventListener('contextmenu', handleContextMenu)
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
