import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Command, Terminal, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/utils/cn'
import { useSnippetStore } from '@/stores/snippetStore'

interface SnippetPaletteProps {
  open: boolean
  onClose: () => void
  onInsert: (command: string) => void
}

export function SnippetPalette({ open, onClose, onInsert }: SnippetPaletteProps) {
  const { snippets, loadSnippets } = useSnippetStore()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Load snippets when opening
  useEffect(() => {
    if (open) {
      loadSnippets()
      setQuery('')
      setSelectedIndex(0)
      // Focus input after mount
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, loadSnippets])

  // Fuzzy filter snippets
  const filtered = useMemo(() => {
    if (!query) return snippets
    const q = query.toLowerCase()
    return snippets.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.shortcut && s.shortcut.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q))
    )
  }, [snippets, query])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [filtered.length, query])

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleSelect = useCallback(
    (command: string) => {
      onInsert(command)
      // Parent's onInsert callback handles closing the palette and refocusing the terminal
    },
    [onInsert]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[selectedIndex]) {
          handleSelect(filtered[selectedIndex].command)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [filtered, selectedIndex, handleSelect, onClose]
  )

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="snippet-palette"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}
          className="absolute top-2 left-1/2 -translate-x-1/2 z-50 w-[480px] max-w-[calc(100%-2rem)]"
        >
          <div className="rounded-lg border border-nd-border bg-nd-bg-secondary shadow-2xl overflow-hidden">
            {/* Search input */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-nd-border">
              <Command size={14} className="text-nd-text-muted shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type to search snippets..."
                className="flex-1 bg-transparent text-sm text-nd-text-primary placeholder:text-nd-text-muted outline-none"
              />
              <span className="text-2xs text-nd-text-muted shrink-0">
                {filtered.length} snippet{filtered.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={onClose}
                className="p-0.5 rounded text-nd-text-muted hover:text-nd-text-primary transition-colors"
              >
                <X size={12} />
              </button>
            </div>

            {/* Results */}
            <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <Terminal size={20} className="mx-auto mb-2 text-nd-text-muted opacity-40" />
                  <p className="text-xs text-nd-text-muted">
                    {snippets.length === 0
                      ? 'No snippets yet — create one in the Snippet Manager'
                      : 'No matching snippets'}
                  </p>
                </div>
              ) : (
                filtered.map((snippet, idx) => (
                  <button
                    key={snippet.id}
                    data-index={idx}
                    onClick={() => handleSelect(snippet.command)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
                      idx === selectedIndex
                        ? 'bg-nd-accent/10 text-nd-text-primary'
                        : 'text-nd-text-secondary hover:bg-nd-surface/50'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-medium truncate">{snippet.name}</span>
                        {snippet.shortcut && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-nd-accent/10 text-nd-accent border border-nd-accent/20 font-mono shrink-0">
                            {snippet.shortcut}
                          </span>
                        )}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-nd-surface text-nd-text-muted border border-nd-border shrink-0">
                          {snippet.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-nd-text-muted font-mono truncate">
                        {snippet.command}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>

            {/* Footer hints */}
            <div className="flex items-center gap-3 px-3 py-1.5 border-t border-nd-border text-2xs text-nd-text-muted">
              <span>
                <kbd className="px-1 py-0.5 rounded bg-nd-surface border border-nd-border text-[9px]">
                  &uarr;&darr;
                </kbd>{' '}
                navigate
              </span>
              <span>
                <kbd className="px-1 py-0.5 rounded bg-nd-surface border border-nd-border text-[9px]">
                  Enter
                </kbd>{' '}
                insert
              </span>
              <span>
                <kbd className="px-1 py-0.5 rounded bg-nd-surface border border-nd-border text-[9px]">
                  Esc
                </kbd>{' '}
                close
              </span>
              <span>
                <kbd className="px-1 py-0.5 rounded bg-nd-surface border border-nd-border text-[9px]">
                  Tab
                </kbd>{' '}
                expand shortcut
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
