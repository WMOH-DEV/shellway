import { cn } from '@/utils/cn'
import type { HostFilter } from '@/utils/ssl/hostRow'

const FILTERS: { id: HostFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs action' },
  { id: 'cloudflare', label: 'Behind Cloudflare' },
  { id: 'certbot', label: 'certbot' }
]

interface HostFilterBarProps {
  value: HostFilter
  counts: Record<HostFilter, number>
  onChange: (filter: HostFilter) => void
}

export function HostFilterBar({ value, counts, onChange }: HostFilterBarProps) {
  return (
    <div role="tablist" aria-label="Filter hostnames" className="flex w-fit flex-wrap items-center gap-1 rounded-lg border border-nd-border bg-nd-bg-sunken p-[3px]">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={value === f.id}
          onClick={() => onChange(f.id)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors',
            value === f.id ? 'bg-nd-surface-raised text-nd-text-primary' : 'text-nd-text-muted hover:text-nd-text-primary'
          )}
        >
          {f.label}
          <span className={cn(f.id === 'attention' && counts.attention > 0 ? 'text-nd-error-fg' : 'text-nd-text-muted')}>{counts[f.id]}</span>
        </button>
      ))}
    </div>
  )
}
