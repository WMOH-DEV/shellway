import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/cn'

export interface ContextMenuItem {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
}

interface ContextMenuProps {
  children: ReactNode
  items: ContextMenuItem[]
  onSelect: (id: string) => void
  className?: string
}

export function ContextMenu({ children, items, onSelect, className }: ContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setPosition({ x: e.clientX, y: e.clientY })
  }, [])

  const close = useCallback(() => setPosition(null), [])

  // Close on click outside or scroll
  useEffect(() => {
    if (!position) return
    const handler = () => close()
    document.addEventListener('click', handler)
    document.addEventListener('scroll', handler, true)
    return () => {
      document.removeEventListener('click', handler)
      document.removeEventListener('scroll', handler, true)
    }
  }, [position, close])

  return (
    <>
      <div onContextMenu={handleContextMenu} className={className}>
        {children}
      </div>

      <AnimatePresence>
        {position && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            className="fixed z-[200] min-w-[180px] rounded-lg bg-nd-bg-secondary border border-nd-border shadow-xl py-1"
            style={{ left: position.x, top: position.y }}
          >
            {items.map((item) =>
              item.separator ? (
                <div key={item.id} className="my-1 border-t border-nd-border" />
              ) : (
                <button
                  key={item.id}
                  disabled={item.disabled}
                  onClick={() => {
                    if (!item.disabled) {
                      onSelect(item.id)
                      close()
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
                  {item.icon && (
                    <span className="shrink-0 w-4 text-nd-text-muted">{item.icon}</span>
                  )}
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
    </>
  )
}
