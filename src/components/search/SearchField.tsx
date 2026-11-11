import { Search } from 'lucide-react'
import { useKeybindingStore } from '@/stores/keybindingStore'
import { useUIStore } from '@/stores/uiStore'
import { formatCombo } from '@/utils/keybindings'
import { cn } from '@/utils/cn'

interface SearchFieldProps {
  className?: string
}

function ShortcutKey({ className }: { className?: string }) {
  const combo = useKeybindingStore((s) => s.bindings['global:search'])
  if (!combo) return null
  return (
    <kbd className={cn('rounded border border-nd-border bg-nd-bg-primary px-1.5 font-mono text-[10.5px] text-nd-text-muted', className)}>
      {formatCombo(combo)}
    </kbd>
  )
}

export function SearchField({ className }: SearchFieldProps) {
  const openSearch = useUIStore((s) => s.openSearch)

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
      <ShortcutKey className="ml-auto" />
    </button>
  )
}

export function SearchButton({ className }: SearchFieldProps) {
  const openSearch = useUIStore((s) => s.openSearch)

  return (
    <button
      type="button"
      aria-label="Search everything"
      onClick={() => openSearch()}
      className={cn(
        'flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-nd-border bg-nd-bg-sunken pl-2 pr-1',
        'text-2xs text-nd-text-muted transition-colors hover:border-nd-border-hover hover:text-nd-text-primary',
        className
      )}
    >
      <Search size={12} className="shrink-0" />
      <span>Search</span>
      <ShortcutKey />
    </button>
  )
}
