import { useEffect, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/utils/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
  /** Max width class (default: max-w-lg) */
  maxWidth?: string
  /** Whether clicking the backdrop closes the modal */
  closeOnBackdrop?: boolean
  /** Whether pressing Escape closes the modal */
  closeOnEscape?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  className,
  maxWidth = 'max-w-lg',
  closeOnBackdrop = true,
  closeOnEscape = true
}: ModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        onClose()
      }
    },
    [closeOnEscape, onClose]
  )

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, handleKeyDown])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeOnBackdrop ? onClose : undefined}
          />

          {/* Modal panel */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={cn(
              'relative z-10 w-full rounded-lg max-h-[85vh] flex flex-col',
              'bg-nd-bg-secondary border border-nd-border shadow-2xl',
              maxWidth,
              className
            )}
          >
            {/* Header */}
            {title && (
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-nd-border">
                <h2 className="text-sm font-semibold text-nd-text-primary">{title}</h2>
                <button
                  onClick={onClose}
                  className="rounded-md p-1 text-nd-text-muted hover:text-nd-text-primary hover:bg-nd-surface transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Body */}
            <div className="px-5 py-4 overflow-y-auto min-h-0">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
