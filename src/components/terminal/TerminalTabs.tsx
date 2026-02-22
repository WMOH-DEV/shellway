import { useState, useCallback, useEffect } from 'react'
import {
  Plus, X, Terminal as TerminalIcon, Search,
  ChevronUp, ChevronDown, Trash2, Code2
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { TerminalView } from './TerminalView'
import { SnippetManager } from '@/components/snippets/SnippetManager'
import { Tooltip } from '@/components/ui/Tooltip'
import { Button } from '@/components/ui/Button'
import { v4 as uuid } from 'uuid'
import type { SearchAddon } from '@xterm/addon-search'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { resolveTerminalSettings, type ResolvedTerminalSettings } from '@/utils/resolveSettings'
import type { AppSettings } from '@/types/settings'

interface TerminalTabsProps {
  connectionId: string
  connectionStatus?: string
}

interface TerminalTab {
  id: string
  name: string
}

/**
 * Multiple terminal sub-tabs per connection.
 * Single unified bar: shell tabs on left, search + tools on right.
 */
export function TerminalTabs({ connectionId, connectionStatus }: TerminalTabsProps) {
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
  const [searchAddons, setSearchAddons] = useState<Map<string, SearchAddon>>(new Map())
  const [clearHandlers, setClearHandlers] = useState<Map<string, () => void>>(new Map())
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false)

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

      setTabs((prev) => prev.filter((t) => t.id !== id))
      if (activeTabId === id) {
        const idx = tabs.findIndex((t) => t.id === id)
        const newActive = tabs[idx - 1] || tabs[idx + 1]
        if (newActive) setActiveTabId(newActive.id)
      }
    },
    [tabs, activeTabId]
  )

  const handleSearch = useCallback(
    (query: string, direction: 'next' | 'prev') => {
      const addon = searchAddons.get(activeTabId)
      if (!addon || !query) return
      if (direction === 'next') {
        addon.findNext(query)
      } else {
        addon.findPrevious(query)
      }
    },
    [searchAddons, activeTabId]
  )

  const registerSearchAddon = useCallback((shellId: string, addon: SearchAddon) => {
    setSearchAddons((prev) => new Map(prev).set(shellId, addon))
  }, [])

  const registerClearHandler = useCallback((shellId: string, clearFn: () => void) => {
    setClearHandlers((prev) => new Map(prev).set(shellId, clearFn))
  }, [])

  const handleClear = useCallback(() => {
    const clearFn = clearHandlers.get(activeTabId)
    if (clearFn) clearFn()
  }, [clearHandlers, activeTabId])

  return (
    <div className="flex flex-col h-full">
      {/* Unified shell tab bar + tools */}
      <div className="flex items-center h-9 bg-nd-bg-secondary border-b border-nd-border shrink-0">
        {/* Shell tabs */}
        <div className="flex items-center overflow-x-auto flex-1 min-w-0">
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
                className="h-5.5 w-32 px-2 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent transition-colors"
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

          <Tooltip content="Command Snippets">
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
            />
          </div>
        ))}
      </div>

      {/* Snippet Manager modal */}
      <SnippetManager
        open={snippetManagerOpen}
        onClose={() => setSnippetManagerOpen(false)}
        onInsert={(command) => {
          window.novadeck.terminal.write(activeTabId, command)
          setSnippetManagerOpen(false)
        }}
      />
    </div>
  )
}
