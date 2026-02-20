import { cn } from '@/utils/cn'

interface ProgressBarProps {
  /** Progress value 0–100 */
  value: number
  /** Show percentage text */
  showLabel?: boolean
  /** Size variant */
  size?: 'sm' | 'md'
  /** Color variant */
  variant?: 'accent' | 'success' | 'warning' | 'error'
  className?: string
}

const variantColors: Record<string, string> = {
  accent: 'bg-nd-accent',
  success: 'bg-nd-success',
  warning: 'bg-nd-warning',
  error: 'bg-nd-error'
}

export function ProgressBar({
  value,
  showLabel = false,
  size = 'md',
  variant = 'accent',
  className
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value))

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className={cn(
          'flex-1 overflow-hidden rounded-full bg-nd-surface',
          size === 'sm' ? 'h-1.5' : 'h-2.5'
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300 ease-out',
            variantColors[variant]
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="shrink-0 text-2xs tabular-nums text-nd-text-muted w-8 text-right">
          {Math.round(clamped)}%
        </span>
      )}
    </div>
  )
}
