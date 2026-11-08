import { cn } from '@/utils/cn'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  count?: number
  alarm?: boolean
}

export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: { options: SegmentOption<T>[]; value: T; onChange(value: T): void; ariaLabel: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex flex-wrap gap-[3px] self-start rounded-lg border border-nd-border bg-nd-bg-sunken p-[3px]">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px]', option.value === value ? 'bg-nd-surface-raised text-nd-text-primary' : 'text-nd-text-muted hover:text-nd-text-primary')}
        >
          {option.label}
          {option.count !== undefined && <span className={cn('text-xs', option.alarm && option.count > 0 ? 'text-nd-error-fg' : 'text-nd-text-muted')}>{option.count}</span>}
        </button>
      ))}
    </div>
  )
}
