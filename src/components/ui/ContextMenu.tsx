import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
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
  const wrapperRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setPosition(null), [])

  // Use native DOM listener (capture phase) — matches the proven working pattern
  // from DataGrid header context menu. React's synthetic onContextMenu doesn't
  // reliably fire in Electron's renderer process.
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const handleContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      setPosition({ x: e.clientX, y: e.clientY })
    }

    wrapper.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      wrapper.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [])

  // Close on mousedown outside menu, any right-click elsewhere, Escape, or scroll
  useEffect(() => {
    if (!position) return

    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    const onScroll = () => close()

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('scroll', onScroll, true)

    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [position, close])

  return (
    <>
      <div ref={wrapperRef} className={className}>
        {children}
      </div>

      <AnimatePresence>
        {position && (
          <motion.div
            ref={menuRef}
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
