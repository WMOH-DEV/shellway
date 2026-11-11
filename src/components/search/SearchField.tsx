import { Search } from 'lucide-react'
import { useKeybindingStore } from '@/stores/keybindingStore'
import { useUIStore } from '@/stores/uiStore'
import { formatCombo } from '@/utils/keybindings'
import { cn } from '@/utils/cn'

interface SearchFieldProps {
  className?: string
}

export function SearchField({ className }: SearchFieldProps) {
  const openSearch = useUIStore((s) => s.openSearch)
  const combo = useKeybindingStore((s) => s.bindings['global:search'])

  return (
    <button
      type="button"
      aria-label="Search everything"
      onClick={() => openSearch()}
      className={cn(
        'flex h-7 w-[260px] shrink-0 items-center gap-2 rounded-md border border-nd-border bg-nd-bg-sunken px-2.5',
        'text-xs text-nd-text-muted transition-colors hover:border-nd-border-hover hover:text-nd-text-secondary',
        className
      )}
    >
      <Search size={13} className="shrink-0" />
      <span>Search everything</span>
      {combo && (
        <kbd className="ml-auto rounded border border-nd-border bg-nd-bg-primary px-1.5 font-mono text-[10.5px] text-nd-text-muted">
          {formatCombo(combo)}
        </kbd>
      )}
    </button>
  )
}
