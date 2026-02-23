import { useState, useRef, useEffect, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'

interface DropdownItem {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
}

interface DropdownProps {
  trigger: ReactNode
  items: DropdownItem[]
  onSelect: (id: string) => void
  align?: 'left' | 'right'
  className?: string
}

export function Dropdown({
  trigger,
  items,
  onSelect,
  align = 'left',
  className
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  return (
    <div ref={ref} className={cn('relative inline-flex', className)}>
      <div onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>{trigger}</div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className={cn(
              'absolute top-full mt-1 z-50 min-w-[180px] rounded-lg',
              'bg-nd-bg-secondary border border-nd-border shadow-xl py-1',
              align === 'right' ? 'right-0' : 'left-0'
            )}
          >
            {items.map((item) =>
              item.separator ? (
                <div key={item.id} className="my-1 border-t border-nd-border" />
              ) : (
                <button
                  key={item.id}
                  disabled={item.disabled}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!item.disabled) {
                      onSelect(item.id)
                      setOpen(false)
                    }
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                    'hover:bg-nd-surface disabled:opacity-40 disabled:cursor-not-allowed',
                    item.danger
                      ? 'text-nd-error hover:text-nd-error'
                      : 'text-nd-text-primary'
                  )}
                >
                  {item.icon && <span className="shrink-0 w-4 text-nd-text-muted">{item.icon}</span>}
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <span className="text-2xs text-nd-text-muted">{item.shortcut}</span>
                  )}
                </button>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
