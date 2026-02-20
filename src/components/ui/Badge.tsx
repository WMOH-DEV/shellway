import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent'

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-nd-surface text-nd-text-secondary border-nd-border',
  success: 'bg-nd-success/15 text-nd-success border-nd-success/30',
  warning: 'bg-nd-warning/15 text-nd-warning border-nd-warning/30',
  error: 'bg-nd-error/15 text-nd-error border-nd-error/30',
  info: 'bg-nd-info/15 text-nd-info border-nd-info/30',
  accent: 'bg-nd-accent/15 text-nd-accent border-nd-accent/30'
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-medium',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
