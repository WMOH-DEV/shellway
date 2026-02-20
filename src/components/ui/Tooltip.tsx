import { useState, useRef, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface TooltipProps {
  content: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number
  className?: string
}

const sideStyles: Record<string, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1.5'
}

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = 400,
  className
}: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay)
  }

  const hide = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setVisible(false)
  }

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      // Hide immediately on click — pointer stays on element so mouseLeave won't fire
      onMouseDown={hide}
    >
      {children}
      {visible && (
        <div
          className={cn(
            'absolute z-[9999] whitespace-nowrap rounded px-2 py-1',
            'bg-nd-surface border border-nd-border text-2xs text-nd-text-secondary shadow-lg',
            'animate-fade-in pointer-events-none',
            sideStyles[side],
            className
          )}
        >
          {content}
        </div>
      )}
    </div>
  )
}
