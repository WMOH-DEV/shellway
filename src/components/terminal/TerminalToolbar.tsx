import {
  Search,
  X,
  ChevronUp,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Trash2,
  SplitSquareVertical,
  SplitSquareHorizontal,
  Code2
} from 'lucide-react'
import { cn } from '@/utils/cn'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'

interface TerminalToolbarProps {
  isSearchOpen: boolean
  onToggleSearch: () => void
  searchQuery: string
  onSearchChange: (query: string) => void
  onSearchNext: () => void
  onSearchPrev: () => void
}

/**
 * Terminal-specific toolbar — search, font size, split, clear, snippets.
 */
export function TerminalToolbar({
  isSearchOpen,
  onToggleSearch,
  searchQuery,
  onSearchChange,
  onSearchNext,
  onSearchPrev
}: TerminalToolbarProps) {
  return (
    <div className="flex items-center h-8 px-2 bg-nd-bg-secondary border-b border-nd-border shrink-0 gap-1">
      {/* Left: actions */}
      <Tooltip content="Search (Ctrl+F)">
        <Button
          variant={isSearchOpen ? 'primary' : 'ghost'}
          size="icon"
          className="h-6 w-6"
          onClick={onToggleSearch}
        >
          <Search size={12} />
        </Button>
      </Tooltip>

      {/* Search bar (inline, expandable) */}
      {isSearchOpen && (
        <div className="flex items-center gap-1 ml-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.shiftKey ? onSearchPrev() : onSearchNext()
              }
              if (e.key === 'Escape') {
                onToggleSearch()
              }
            }}
            placeholder="Search..."
            autoFocus
            className="h-5 w-40 px-2 rounded bg-nd-surface border border-nd-border text-xs text-nd-text-primary placeholder:text-nd-text-muted focus:outline-none focus:border-nd-accent"
          />
          <button onClick={onSearchPrev} className="p-0.5 text-nd-text-muted hover:text-nd-text-primary">
            <ChevronUp size={12} />
          </button>
          <button onClick={onSearchNext} className="p-0.5 text-nd-text-muted hover:text-nd-text-primary">
            <ChevronDown size={12} />
          </button>
          <button onClick={onToggleSearch} className="p-0.5 text-nd-text-muted hover:text-nd-text-primary">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="flex-1" />

      {/* Right: tools */}
      <Tooltip content="Command Snippets">
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <Code2 size={12} />
        </Button>
      </Tooltip>

      <div className="w-px h-4 bg-nd-border mx-0.5" />

      <Tooltip content="Clear Terminal">
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <Trash2 size={12} />
        </Button>
      </Tooltip>
    </div>
  )
}
