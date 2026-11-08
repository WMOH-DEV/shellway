import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export function CardLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-nd-text-dim">{children}</span>
}

interface CardProps {
  label: ReactNode
  ariaLabel: string
  aside?: ReactNode
  className?: string
  children: ReactNode
}

export function Card({ label, ariaLabel, aside, className, children }: CardProps) {
  return (
    <section aria-label={ariaLabel} className={cn('flex min-w-0 flex-col gap-3 rounded-[10px] border border-nd-border bg-nd-surface p-4', className)}>
      <div className="flex items-center gap-2.5">
        <CardLabel>{label}</CardLabel>
        {aside && <><div className="flex-1" />{aside}</>}
      </div>
      {children}
    </section>
  )
}
