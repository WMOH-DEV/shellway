import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface SectionCardProps {
  title: ReactNode
  ariaLabel?: string
  count?: ReactNode
  aside?: ReactNode
  flush?: boolean
  className?: string
  children: ReactNode
}

export function SectionCard({ title, ariaLabel, count, aside, flush, className, children }: SectionCardProps) {
  return (
    <section aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)} className={cn('flex min-w-0 flex-col rounded-xl border border-nd-border bg-nd-surface', flush ? 'overflow-hidden' : 'gap-3 p-4', className)}>
      <div className={cn('flex items-center gap-2.5', flush && 'border-b border-nd-border px-4 py-3.5')}>
        <h2 className="text-[15px] font-semibold text-nd-text-primary">{title}</h2>
        {count !== undefined && <span className="text-xs text-nd-text-muted">{count}</span>}
        {aside && <><div className="flex-1" />{aside}</>}
      </div>
      {children}
    </section>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-nd-text-dim">{children}</span>
}
