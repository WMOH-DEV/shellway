import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { ChevronRight, Home, Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useSFTPPathStore } from '@/stores/sftpPathStore'
import type { SFTPAutocompleteMode } from '@/types/settings'

interface PathBreadcrumbProps {
  path: string
  separator?: string
  onNavigate: (path: string) => void
  className?: string
  /** Required for autocomplete functionality */
  connectionId?: string
  panelType?: 'local' | 'remote'
  sessionId?: string
  /** Autocomplete mode — loaded from settings */
  autocompleteMode?: SFTPAutocompleteMode
}

interface Suggestion {
  /** Full path to navigate to */
  path: string
  /** Display label (just the folder/file name) */
  label: string
  isDirectory: boolean
}

/**
 * Clickable breadcrumb path bar with editable mode and autocomplete.
 * Click on segments to navigate, click on the bar to edit manually.
 * While editing, shows autocomplete suggestions from either:
 * - Content-based: fetches directory listing for the parent path
 * - History-based: filters from previously visited paths
 */
export function PathBreadcrumb({
  path,
  separator = '/',
  onNavigate,
  className,
  connectionId,
  panelType,
  sessionId,
  autocompleteMode = 'content'
}: PathBreadcrumbProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(path)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Content-based cache: parentDir → Suggestion[]
  const contentCacheRef = useRef<Map<string, Suggestion[]>>(new Map())

  // Get path history for history-based mode
  const pathHistory = useSFTPPathStore((s) =>
    sessionId && panelType ? s.getPathHistory(sessionId, panelType) : []
  )

  useEffect(() => {
    setEditValue(path)
  }, [path])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const segments = path.split(separator).filter(Boolean)
  const isWindows = path.includes('\\') || (segments[0] && /^[A-Z]:$/i.test(segments[0]))

  const handleSegmentClick = (index: number) => {
    if (isWindows) {
      const navPath = segments.slice(0, index + 1).join('\\')
      onNavigate(navPath.includes(':') ? navPath + '\\' : navPath)
    } else {
      onNavigate('/' + segments.slice(0, index + 1).join('/'))
    }
  }

  /** Extract the parent directory from a path */
  const getParentDir = useCallback((p: string): string => {
    const sep = p.includes('\\') ? '\\' : '/'
    // If path ends with separator, the "parent" is the path itself (user wants contents of this dir)
    if (p.endsWith(sep) && p.length > 1) return p
    const parts = p.split(sep).filter(Boolean)
    if (parts.length <= 1) return isWindows ? parts[0] + '\\' : '/'
    parts.pop()
    return isWindows ? parts.join('\\') : '/' + parts.join('/')
  }, [isWindows])

  /** Get the typed prefix after the last separator (for filtering) */
  const getTypedPrefix = useCallback((p: string): string => {
    const sep = p.includes('\\') ? '\\' : '/'
    if (p.endsWith(sep)) return ''
    const parts = p.split(sep)
    return parts[parts.length - 1]?.toLowerCase() || ''
  }, [])

  /** Fetch directory contents for content-based autocomplete */
  const fetchContentSuggestions = useCallback(async (inputPath: string) => {
    if (!connectionId) return

    const parentDir = getParentDir(inputPath)
    const prefix = getTypedPrefix(inputPath)

    // Check cache first
    const cached = contentCacheRef.current.get(parentDir)
    if (cached) {
      const filtered = prefix
        ? cached.filter((s) => s.label.toLowerCase().startsWith(prefix))
        : cached.filter((s) => s.isDirectory)
      setSuggestions(filtered.slice(0, 15))
      setSelectedIndex(-1)
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      let result: { success: boolean; data?: any[]; error?: string }

      if (panelType === 'remote') {
        result = await window.novadeck.sftp.readdir(connectionId, parentDir)
      } else {
        result = await window.novadeck.sftp.localReaddir(parentDir)
      }

      if (result.success && result.data) {
        const sep = parentDir.includes('\\') ? '\\' : '/'
        const allSuggestions: Suggestion[] = result.data
          .filter((entry: any) => entry.isDirectory)
          .map((entry: any) => ({
            path: parentDir.endsWith(sep)
              ? parentDir + entry.name
              : parentDir + sep + entry.name,
            label: entry.name,
            isDirectory: true
          }))

        // Cache the result
        contentCacheRef.current.set(parentDir, allSuggestions)

        const filtered = prefix
          ? allSuggestions.filter((s) => s.label.toLowerCase().startsWith(prefix))
          : allSuggestions
        setSuggestions(filtered.slice(0, 15))
        setSelectedIndex(-1)
      }
    } catch {
      // Silently fail — autocomplete is best-effort
    } finally {
      setLoading(false)
    }
  }, [connectionId, panelType, getParentDir, getTypedPrefix])

  /** Filter history-based suggestions */
  const getHistorySuggestions = useCallback((inputPath: string) => {
    const lower = inputPath.toLowerCase()
    const filtered = pathHistory
      .filter((p) => p.toLowerCase().startsWith(lower) && p !== inputPath)
      .sort()
      .slice(0, 15)
      .map((p) => ({
        path: p,
        label: p,
        isDirectory: true
      }))
    setSuggestions(filtered)
    setSelectedIndex(-1)
    setLoading(false)
  }, [pathHistory])

  /** Trigger autocomplete based on current mode */
  const triggerAutocomplete = useCallback((value: string) => {
    if (!value || value.length < 2) {
      setSuggestions([])
      return
    }

    if (autocompleteMode === 'content') {
      // Content-based: debounce to avoid hammering SFTP on every keystroke
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        fetchContentSuggestions(value)
      }, 200)
    } else {
      // History-based: instant, no network
      getHistorySuggestions(value)
    }
  }, [autocompleteMode, fetchContentSuggestions, getHistorySuggestions])

  /** Handle input changes */
  const handleChange = useCallback((value: string) => {
    setEditValue(value)
    triggerAutocomplete(value)
  }, [triggerAutocomplete])

  /** Select a suggestion */
  const handleSelectSuggestion = useCallback((suggestion: Suggestion) => {
    const sep = suggestion.path.includes('\\') ? '\\' : '/'
    // If it's a directory, append separator to hint at navigating inside
    const val = suggestion.isDirectory && !suggestion.path.endsWith(sep)
      ? suggestion.path + sep
      : suggestion.path
    setEditValue(val)
    setSuggestions([])
    setSelectedIndex(-1)
    // Immediately trigger autocomplete for the new value (to show next level)
    if (suggestion.isDirectory) {
      triggerAutocomplete(val)
    }
    inputRef.current?.focus()
  }, [triggerAutocomplete])

  const handleSubmit = () => {
    setIsEditing(false)
    setSuggestions([])
    if (editValue.trim() && editValue.trim() !== path) {
      onNavigate(editValue.trim())
    }
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
        e.preventDefault()
        handleSelectSuggestion(suggestions[selectedIndex])
      } else {
        handleSubmit()
      }
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setSuggestions([])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : 0
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : suggestions.length - 1
      )
    } else if (e.key === 'Tab' && suggestions.length > 0) {
      e.preventDefault()
      const idx = selectedIndex >= 0 ? selectedIndex : 0
      if (suggestions[idx]) {
        handleSelectSuggestion(suggestions[idx])
      }
    }
  }, [selectedIndex, suggestions, handleSelectSuggestion])

  // Scroll selected suggestion into view
  useEffect(() => {
    if (selectedIndex >= 0 && dropdownRef.current) {
      const items = dropdownRef.current.querySelectorAll('[data-suggestion]')
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (isEditing) {
    return (
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={() => {
            // Delay to allow click on suggestion
            setTimeout(() => {
              setIsEditing(false)
              setSuggestions([])
            }, 200)
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            'w-full h-7 px-2 rounded bg-nd-surface border border-nd-accent text-xs text-nd-text-primary font-mono',
            'focus:outline-none',
            className
          )}
        />
        {/* Autocomplete dropdown */}
        {(suggestions.length > 0 || loading) && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 mt-1 z-[100] max-h-[200px] overflow-y-auto rounded-md bg-nd-bg-secondary border border-nd-border shadow-xl py-1"
          >
            {loading && suggestions.length === 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-nd-text-muted">
                <Loader2 size={12} className="animate-spin" />
                Loading...
              </div>
            )}
            {suggestions.map((suggestion, i) => (
              <button
                key={suggestion.path}
                data-suggestion
                onMouseDown={(e) => {
                  e.preventDefault() // Prevent input blur
                  handleSelectSuggestion(suggestion)
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                  i === selectedIndex
                    ? 'bg-nd-surface text-nd-text-primary'
                    : 'text-nd-text-secondary hover:bg-nd-surface hover:text-nd-text-primary'
                )}
              >
                <span className="truncate font-mono">{suggestion.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      className={cn(
        'flex items-center gap-0.5 h-7 px-2 rounded bg-nd-surface border border-nd-border cursor-text overflow-hidden',
        'hover:border-nd-border-hover transition-colors',
        className
      )}
    >
      {/* Home button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onNavigate(isWindows ? 'C:\\' : '/')
        }}
        className="shrink-0 p-0.5 rounded text-nd-text-muted hover:text-nd-accent transition-colors"
      >
        <Home size={12} />
      </button>

      <ChevronRight size={10} className="text-nd-text-muted shrink-0" />

      {/* Path segments */}
      <div className="flex items-center gap-0.5 overflow-hidden">
        {segments.map((segment, i) => (
          <div key={i} className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleSegmentClick(i)
              }}
              className="text-xs text-nd-text-secondary hover:text-nd-accent transition-colors truncate max-w-[120px]"
            >
              {segment}
            </button>
            {i < segments.length - 1 && (
              <ChevronRight size={10} className="text-nd-text-muted shrink-0" />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
