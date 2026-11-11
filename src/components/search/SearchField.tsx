import { Search } from 'lucide-react'
import { useKeybindingStore } from '@/stores/keybindingStore'
import { useUIStore } from '@/stores/uiStore'
import { formatCombo } from '@/utils/keybindings'
import { cn } from '@/utils/cn'

interface SearchButtonProps {
  className?: string
}

function ShortcutKey() {
  const combo = useKeybindingStore((s) => s.bindings['global:search'])
  if (!combo) return null
  return (
    <kbd className="rounded border border-nd-border bg-nd-bg-primary px-1.5 font-mono text-[10.5px] text-nd-text-muted">
      {formatCombo(combo)}
    </kbd>
  )
}

export function SearchButton({ className }: SearchButtonProps) {
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
