import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional label above the input */
  label?: string
  /** Optional error message below the input */
  error?: string
  /** Optional left icon element */
  icon?: React.ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-nd-text-secondary">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-nd-text-muted">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'h-8 w-full rounded-md border bg-nd-surface px-3 text-sm text-nd-text-primary',
              'border-nd-border placeholder:text-nd-text-muted',
              'transition-colors duration-150',
              'hover:border-nd-border-hover',
              'focus:outline-none focus:border-nd-accent focus:ring-1 focus:ring-nd-accent',
              'disabled:cursor-not-allowed disabled:opacity-50',
              icon && 'pl-9',
              error && 'border-nd-error focus:border-nd-error focus:ring-nd-error',
              className
            )}
            {...props}
          />
        </div>
        {error && <p className="text-2xs text-nd-error">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
