import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { Search, ChevronDown, Check } from 'lucide-react'
import { cn } from '@/utils/cn'
import { getAvailableMonospaceFonts } from '@/utils/fontDetector'

interface FontPickerProps {
  value: string
  onChange: (font: string) => void
  label?: string
}

export function FontPicker({ value, onChange, label }: FontPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Compute available fonts once
  const availableFonts = useMemo(() => {
    return getAvailableMonospaceFonts().filter((f) => f.available)
  }, [])

  // Filtered list based on search
  const filtered = useMemo(() => {
    if (!search.trim()) return availableFonts
    const q = search.toLowerCase()
    return availableFonts.filter((f) => f.name.toLowerCase().includes(q))
  }, [availableFonts, search])

  // Extract the primary font name from a potentially comma-separated value
  const primaryFont = useMemo(() => {
    return value.split(',')[0].trim().replace(/['"]/g, '')
  }, [value])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Focus search when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus())
    } else {
      setSearch('')
    }
  }, [open])

  // Scroll selected font into view when opened
  useEffect(() => {
    if (!open || !listRef.current) return
    requestAnimationFrame(() => {
      const active = listRef.current?.querySelector('[data-active="true"]')
      if (active) {
        active.scrollIntoView({ block: 'nearest' })
      }
    })
  }, [open])

  const handleSelect = useCallback(
    (fontName: string) => {
      // Build a proper font-family value with monospace fallback
      onChange(`${fontName}, monospace`)
      setOpen(false)
    },
    [onChange]
  )

  return (
    <div className="flex flex-col gap-1" ref={containerRef}>
      {label && (
        <label className="text-xs font-medium text-nd-text-secondary">{label}</label>
      )}

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-8 w-full rounded-md border bg-nd-surface px-3 text-sm text-nd-text-primary',
          'border-nd-border',
          'transition-colors duration-150',
          'hover:border-nd-border-hover',
          'focus:outline-none focus:border-nd-accent focus:ring-1 focus:ring-nd-accent',
          'flex items-center justify-between gap-2 cursor-pointer'
        )}
      >
        <span
          className="truncate"
          style={{ fontFamily: `"${primaryFont}", monospace` }}
        >
          {primaryFont || 'Select a font...'}
        </span>
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-nd-text-muted transition-transform duration-150',
            open && 'rotate-180'
          )}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className={cn(
            'relative z-50 mt-1 w-full rounded-lg border border-nd-border',
            'bg-nd-bg-secondary shadow-xl shadow-black/20',
            'flex flex-col overflow-hidden'
          )}
        >
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-nd-border">
            <Search size={13} className="shrink-0 text-nd-text-muted" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fonts..."
              className="flex-1 bg-transparent text-sm text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none"
            />
          </div>

          {/* Font list */}
          <div ref={listRef} className="max-h-[200px] overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-nd-text-muted text-center">
                No matching fonts found
              </div>
            )}
            {filtered.map((font) => {
              const isSelected = primaryFont === font.name
              return (
                <button
                  key={font.name}
                  type="button"
                  data-active={isSelected}
                  onClick={() => handleSelect(font.name)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                    isSelected
                      ? 'bg-nd-accent/10 text-nd-accent'
                      : 'text-nd-text-primary hover:bg-nd-surface'
                  )}
                >
                  <span className="w-4 shrink-0 flex items-center justify-center">
                    {isSelected && <Check size={12} />}
                  </span>
                  <span
                    className="truncate"
                    style={{ fontFamily: `"${font.name}", monospace` }}
                  >
                    {font.name}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Font count */}
          <div className="border-t border-nd-border px-3 py-1.5">
            <span className="text-2xs text-nd-text-muted">
              {filtered.length} of {availableFonts.length} fonts
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
