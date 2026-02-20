import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-nd-accent text-white hover:bg-nd-accent-hover active:bg-blue-700 shadow-sm',
  secondary:
    'bg-nd-surface text-nd-text-primary hover:bg-nd-surface-hover active:bg-nd-bg-tertiary border border-nd-border',
  ghost:
    'text-nd-text-secondary hover:text-nd-text-primary hover:bg-nd-surface active:bg-nd-surface-hover',
  danger:
    'bg-nd-error text-white hover:bg-red-600 active:bg-red-700 shadow-sm',
  outline:
    'border border-nd-border text-nd-text-primary hover:bg-nd-surface hover:border-nd-border-hover active:bg-nd-surface-hover'
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs rounded',
  md: 'h-8 px-3 text-sm rounded-md',
  lg: 'h-10 px-4 text-sm rounded-md',
  icon: 'h-8 w-8 rounded-md flex items-center justify-center'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nd-accent focus-visible:ring-offset-1 focus-visible:ring-offset-nd-bg-primary',
          'disabled:pointer-events-none disabled:opacity-50',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
