import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent'

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-nd-surface-raised text-nd-text-muted',
  success: 'bg-nd-success/12 text-nd-success-fg',
  warning: 'bg-nd-warning/12 text-nd-warning-fg',
  error: 'bg-nd-error/12 text-nd-error-fg',
  info: 'bg-nd-info/12 text-nd-info-fg',
  accent: 'bg-nd-accent/12 text-nd-accent-hover'
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
