import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  options: SelectOption[]
  error?: string
  placeholder?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, options, error, placeholder, id, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selectId} className="text-xs font-medium text-nd-text-secondary">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'h-8 w-full rounded-md border bg-nd-surface px-3 text-sm text-nd-text-primary',
            'border-nd-border appearance-none cursor-pointer',
            'transition-colors duration-150',
            'hover:border-nd-border-hover',
            'focus:outline-none focus:border-nd-accent focus:ring-1 focus:ring-nd-accent',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error && 'border-nd-error focus:border-nd-error focus:ring-nd-error',
            className
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p className="text-2xs text-nd-error">{error}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'
