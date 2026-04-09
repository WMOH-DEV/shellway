import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import {
  Plus, X, Terminal as TerminalIcon, Search,
  ChevronUp, ChevronDown, Trash2, Code2
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { TerminalView } from './TerminalView'
import { SnippetPalette } from './SnippetPalette'
import { SnippetManager } from '@/components/snippets/SnippetManager'
import { Tooltip } from '@/components/ui/Tooltip'
import { Button } from '@/components/ui/Button'
import { toast } from '@/components/ui/Toast'
import { v4 as uuid } from 'uuid'
import type { SearchAddon } from '@xterm/addon-search'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { resolveTerminalSettings, type ResolvedTerminalSettings } from '@/utils/resolveSettings'
import { formatCombo } from '@/utils/keybindings'
import { getBinding } from '@/stores/keybindingStore'
import type { AppSettings } from '@/types/settings'

interface TerminalTabsProps {
  connectionId: string
  connectionStatus?: string
}

/** Imperative handle exposed by TerminalTabs for parent-driven actions. */
export interface TerminalTabsHandle {
  /**
   * Pop the currently-active shell out into a standalone BrowserWindow.
   * The shell itself stays alive in the main process and is adopted by the
   * new window; main-window UI creates a fresh replacement shell if this
   * was the only open tab.
   */
  popOutActive(): Promise<void>
}

interface TerminalTab {
  id: string
  name: string
}

/**
 * Multiple terminal sub-tabs per connection.
 * Single unified bar: shell tabs on left, search + tools on right.
 */
export const TerminalTabs = forwardRef<TerminalTabsHandle, TerminalTabsProps>(function TerminalTabs(
  { connectionId, connectionStatus },
  ref
) {
  // ── Resolve terminal settings: global + session overrides ──
  const [resolvedSettings, setResolvedSettings] = useState<ResolvedTerminalSettings | undefined>()

  // Look up the session overrides from stores
  const connectionTab = useConnectionStore((s) => s.tabs.find((t) => t.id === connectionId))
  const session = useSessionStore((s) =>
    connectionTab ? s.sessions.find((sess) => sess.id === connectionTab.sessionId) : undefined
  )

  useEffect(() => {
    window.novadeck.settings.getAll().then((globalSettings: AppSettings) => {
      const termOverrides = session?.overrides?.terminal
      const resolved = resolveTerminalSettings(globalSettings, termOverrides)
      setResolvedSettings(resolved)
    })
  }, [session?.overrides?.terminal])

  const [tabs, setTabs] = useState<TerminalTab[]>(() => [
    { id: uuid(), name: 'Shell 1' }
  ])
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id)
  // Handler maps — stored as refs (not state) because they are lookup tables for
  // imperative callbacks, not drivers of UI rendering. Using useState caused 4
  // unnecessary re-renders per terminal tab creation.
  const searchAddonsRef = useRef(new Map<string, SearchAddon>())
  const clearHandlersRef = useRef(new Map<string, () => void>())
  const focusHandlersRef = useRef(new Map<string, () => void>())
  const pasteHandlersRef = useRef(new Map<string, (text: string) => void>())
  const serializeHandlersRef = useRef(new Map<string, () => string>())
  // Guard against concurrent pop-outs of the same shell (e.g. rapid double
  // clicks). Without this, two openStandalone calls would serialize the same
  // buffer twice — currently safe due to sessionId dedupe in main.ts, but
  // trivially exploitable if that dedupe is ever relaxed.
  const poppingRef = useRef(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false)
  const [snippetPaletteOpen, setSnippetPaletteOpen] = useState(false)

  const addTab = useCallback(() => {
    const newTab: TerminalTab = {
      id: uuid(),
      name: `Shell ${tabs.length + 1}`
    }
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
  }, [tabs.length])

  const closeTab = useCallback(
    (id: string) => {
      // Don't close the last tab
      if (tabs.length <= 1) return

      window.novadeck.terminal.close(id)

      // Clean up handler maps to avoid holding references to disposed Terminal instances
      searchAddonsRef.current.delete(id)
      clearHandlersRef.current.delete(id)
      focusHandlersRef.current.delete(id)
      pasteHandlersRef.current.delete(id)
      serializeHandlersRef.current.delete(id)

      setTabs((prev) => prev.filter((t) => t.id !== id))
      if (activeTabId === id) {
        const idx = tabs.findIndex((t) => t.id === id)
        const newActive = tabs[idx - 1] || tabs[idx + 1]
        if (newActive) setActiveTabId(newActive.id)
      }
    },
    [tabs, activeTabId]
  )

  // ── Pop out the active shell into a standalone BrowserWindow ──
  //
  // Single-owner semantics: the shellId and its underlying main-process
  // ClientChannel are transferred to the new window. We do NOT call
  // terminal.close on the shellId (that would kill the shell). We only
  // remove the shell tab from this window's local UI state and dispose the
  // xterm instance via its unmount cleanup. If this was the only tab open,
  // auto-create a fresh blank shell to keep the invariant "main window always
  // has ≥1 terminal tab".
  const popOutActive = useCallback(async () => {
    if (poppingRef.current) return
    poppingRef.current = true

    const activeShellId = activeTabId
    const serializeFn = serializeHandlersRef.current.get(activeShellId)
    if (!serializeFn) {
      poppingRef.current = false
      toast.error('Pop out failed', 'Terminal is not ready yet')
      return
    }

    let snapshot = ''
    try {
      snapshot = serializeFn()
    } catch (err) {
      console.warn('[terminal pop-out] serialize failed:', err)
    }

    const sourceTab = useConnectionStore.getState().tabs.find(t => t.id === connectionId)
    if (!sourceTab) {
      poppingRef.current = false
      toast.error('Pop out failed', 'Source tab not found')
      return
    }

    try {
      const result = await window.novadeck.window.openStandalone({
        mode: 'terminal',
        sessionId: sourceTab.sessionId,
        name: sourceTab.sessionName,
        sessionColor: sourceTab.sessionColor,
        connectionId,
        viaSSHConnectionId: connectionId,
        shellId: activeShellId,
        bufferSnapshot: snapshot,
      })

      if (result.focusedExisting) {
        poppingRef.current = false
        return
      }

      // Remove the popped shell from local UI state WITHOUT calling
      // terminal.close (the new window owns the shell now). Clean up the
      // handler maps to release xterm references.
      searchAddonsRef.current.delete(activeShellId)
      clearHandlersRef.current.delete(activeShellId)
      focusHandlersRef.current.delete(activeShellId)
      pasteHandlersRef.current.delete(activeShellId)
      serializeHandlersRef.current.delete(activeShellId)

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== activeShellId)
        if (remaining.length === 0) {
          // Maintain the ≥1-tab invariant — create a fresh blank shell so the
          // user isn't left with an empty Terminal sub-tab.
          const replacement: TerminalTab = { id: uuid(), name: 'Shell 1' }
          setActiveTabId(replacement.id)
          return [replacement]
        }
        // Activate the next remaining tab
        const idx = prev.findIndex(t => t.id === activeShellId)
        const newActive = remaining[Math.min(idx, remaining.length - 1)]
        setActiveTabId(newActive.id)
        return remaining
      })
    } catch (err) {
      toast.error('Pop out failed', err instanceof Error ? err.message : String(err))
    } finally {
      poppingRef.current = false
    }
  }, [activeTabId, connectionId])

  useImperativeHandle(ref, () => ({ popOutActive }), [popOutActive])

  const handleSearch = useCallback(
    (query: string, direction: 'next' | 'prev') => {
      const addon = searchAddonsRef.current.get(activeTabId)
      if (!addon || !query) return
      if (direction === 'next') {
        addon.findNext(query)
      } else {
        addon.findPrevious(query)
      }
    },
    [activeTabId]
  )

  const registerSearchAddon = useCallback((shellId: string, addon: SearchAddon) => {
    searchAddonsRef.current.set(shellId, addon)
  }, [])

  const registerClearHandler = useCallback((shellId: string, clearFn: () => void) => {
    clearHandlersRef.current.set(shellId, clearFn)
  }, [])

  const registerFocusHandler = useCallback((shellId: string, focusFn: () => void) => {
    focusHandlersRef.current.set(shellId, focusFn)
  }, [])

  const registerPasteHandler = useCallback((shellId: string, pasteFn: (text: string) => void) => {
    pasteHandlersRef.current.set(shellId, pasteFn)
  }, [])

  const registerSerializeHandler = useCallback((shellId: string, serializeFn: () => string) => {
    serializeHandlersRef.current.set(shellId, serializeFn)
  }, [])

  const handleClear = useCallback(() => {
    const clearFn = clearHandlersRef.current.get(activeTabId)
    if (clearFn) clearFn()
  }, [activeTabId])

  /** Re-focus the active terminal (e.g. after palette/modal closes) */
  const refocusTerminal = useCallback(() => {
    requestAnimationFrame(() => {
      const focusFn = focusHandlersRef.current.get(activeTabId)
      if (focusFn) focusFn()
    })
  }, [activeTabId])

  /** Insert text into the active terminal via xterm paste (flows through onData for buffer tracking) */
  const pasteIntoTerminal = useCallback((text: string) => {
    const pasteFn = pasteHandlersRef.current.get(activeTabId)
    if (pasteFn) {
      pasteFn(text)
    } else {
      // Fallback to direct IPC write if paste handler not yet registered
      window.novadeck.terminal.write(activeTabId, text)
    }
  }, [activeTabId])

  return (
    <div className="flex flex-col h-full">
      {/* Unified shell tab bar + tools */}
      <div className="flex items-center h-9 bg-nd-bg-secondary border-b border-nd-border shrink-0">
        {/* Shell tabs */}
        <div className="flex items-center overflow-x-auto scrollbar-none flex-1 min-w-0">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={cn(
                  'group flex items-center gap-1.5 px-3.5 h-9 cursor-pointer text-xs transition-colors shrink-0',
                  'border-b-2 -mb-px',
                  isActive
                    ? 'border-nd-accent text-nd-text-primary bg-nd-bg-primary/50'
                    : 'border-transparent text-nd-text-muted hover:text-nd-text-secondary hover:bg-nd-bg-tertiary/30'
                )}
              >
                <TerminalIcon size={12} className={isActive ? 'text-nd-accent' : ''} />
                <span className="truncate max-w-[100px]">{tab.name}</span>
                {tabs.length > 1 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.id)
                    }}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-all ml-0.5"
                  >
                    <X size={10} />
                  </span>
                )}
              </button>
            )
          })}

          {/* New shell button */}
          <Tooltip content="New Shell">
            <button
              onClick={addTab}
              className="shrink-0 px-2 h-9 text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface/60 transition-colors"
            >
              <Plus size={13} />
            </button>
          </Tooltip>
        </div>

        {/* Separator */}
        <div className="w-px h-4 bg-nd-border mx-1 shrink-0" />

        {/* Tools: search toggle + clear */}
        <div className="flex items-center gap-0.5 px-1 shrink-0">
          {isSearchOpen && (
            <div className="flex items-center gap-0.5 mr-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.shiftKey ? handleSearch(searchQuery, 'prev') : handleSearch(searchQuery, 'next')
                  }
                  if (e.key === 'Escape') {
                    setIsSearchOpen(false)
                  }
                }}
                placeholder="Find..."
                autoFocus
                className="h-5.5 w-24 min-w-[60px] px-2 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors"
              />
              <button onClick={() => handleSearch(searchQuery, 'prev')} className="p-0.5 text-nd-text-muted hover:text-nd-text-primary transition-colors">
                <ChevronUp size={12} />
              </button>
              <button onClick={() => handleSearch(searchQuery, 'next')} className="p-0.5 text-nd-text-muted hover:text-nd-text-primary transition-colors">
                <ChevronDown size={12} />
              </button>
              <button onClick={() => setIsSearchOpen(false)} className="p-0.5 text-nd-text-muted hover:text-nd-text-primary transition-colors">
                <X size={12} />
              </button>
            </div>
          )}

          <Tooltip content="Search (Ctrl+F)">
            <Button
              variant={isSearchOpen ? 'primary' : 'ghost'}
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsSearchOpen(!isSearchOpen)}
            >
              <Search size={12} />
            </Button>
          </Tooltip>

          <Tooltip content={`Command Snippets (${formatCombo(getBinding('terminal:snippetPalette'))} for quick palette)`}>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setSnippetManagerOpen(true)}
            >
              <Code2 size={12} />
            </Button>
          </Tooltip>

          <Tooltip content="Clear Terminal">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleClear}>
              <Trash2 size={12} />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Terminal views — relative+overflow-hidden ensures ResizeObserver fires on height changes */}
      {/* Defer rendering until settings are resolved to avoid creating terminals with hardcoded defaults */}
      <div className="flex-1 relative overflow-hidden">
        {resolvedSettings && tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              'absolute inset-0',
              tab.id !== activeTabId && 'hidden'
            )}
          >
            <TerminalView
              shellId={tab.id}
              connectionId={connectionId}
              connectionStatus={connectionStatus}
              isActive={tab.id === activeTabId}
              terminalSettings={resolvedSettings}
              onSearchAddon={(addon) => registerSearchAddon(tab.id, addon)}
              onSearchRequest={() => {
                setIsSearchOpen(true)
              }}
              onClearHandler={(clearFn) => registerClearHandler(tab.id, clearFn)}
              onFocusHandler={(focusFn) => registerFocusHandler(tab.id, focusFn)}
              onPasteHandler={(pasteFn) => registerPasteHandler(tab.id, pasteFn)}
              onSerializeHandler={(fn) => registerSerializeHandler(tab.id, fn)}
              onSnippetPaletteRequest={() => setSnippetPaletteOpen(true)}
            />
          </div>
        ))}

        {/* Snippet quick palette */}
        <SnippetPalette
          open={snippetPaletteOpen}
          onClose={() => {
            setSnippetPaletteOpen(false)
            refocusTerminal()
          }}
          onInsert={(command) => {
            pasteIntoTerminal(command)
            setSnippetPaletteOpen(false)
            refocusTerminal()
          }}
        />
      </div>

      {/* Snippet Manager modal */}
      <SnippetManager
        open={snippetManagerOpen}
        onClose={() => {
          setSnippetManagerOpen(false)
          refocusTerminal()
        }}
        onInsert={(command) => {
          pasteIntoTerminal(command)
          setSnippetManagerOpen(false)
          refocusTerminal()
        }}
      />
    </div>
  )
})
