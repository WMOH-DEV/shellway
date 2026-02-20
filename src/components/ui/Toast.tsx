import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/utils/cn'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastData {
  id: string
  type: ToastType
  title: string
  message?: string
  duration?: number // ms, 0 = persistent
}

const icons: Record<ToastType, ReactNode> = {
  success: <CheckCircle size={16} className="text-nd-success" />,
  error: <AlertCircle size={16} className="text-nd-error" />,
  warning: <AlertTriangle size={16} className="text-nd-warning" />,
  info: <Info size={16} className="text-nd-info" />
}

const borderColors: Record<ToastType, string> = {
  success: 'border-l-nd-success',
  error: 'border-l-nd-error',
  warning: 'border-l-nd-warning',
  info: 'border-l-nd-info'
}

// ── Toast manager (singleton) ──
type ToastListener = (toasts: ToastData[]) => void
let toasts: ToastData[] = []
let listeners: ToastListener[] = []
let toastId = 0

function notify() {
  listeners.forEach((l) => l([...toasts]))
}

export const toast = {
  show(data: Omit<ToastData, 'id'>) {
    const id = String(++toastId)
    toasts = [...toasts, { ...data, id }]
    notify()

    const duration = data.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => toast.dismiss(id), duration)
    }
    return id
  },
  success(title: string, message?: string) {
    return toast.show({ type: 'success', title, message })
  },
  error(title: string, message?: string) {
    return toast.show({ type: 'error', title, message })
  },
  warning(title: string, message?: string) {
    return toast.show({ type: 'warning', title, message })
  },
  info(title: string, message?: string) {
    return toast.show({ type: 'info', title, message })
  },
  dismiss(id: string) {
    toasts = toasts.filter((t) => t.id !== id)
    notify()
  },
  subscribe(listener: ToastListener) {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((l) => l !== listener)
    }
  }
}

/** Toast container — render once at app root */
export function ToastContainer() {
  const [items, setItems] = useState<ToastData[]>([])

  useEffect(() => {
    return toast.subscribe(setItems)
  }, [])

  return (
    <div className="fixed bottom-12 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      <AnimatePresence>
        {items.map((t) => (
          <ToastItem key={t.id} data={t} onDismiss={() => toast.dismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function ToastItem({ data, onDismiss }: { data: ToastData; onDismiss: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-nd-border bg-nd-bg-secondary p-3 shadow-lg border-l-[3px]',
        borderColors[data.type]
      )}
    >
      <span className="mt-0.5 shrink-0">{icons[data.type]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-nd-text-primary">{data.title}</p>
        {data.message && (
          <p className="text-xs text-nd-text-secondary mt-0.5">{data.message}</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 text-nd-text-muted hover:text-nd-text-primary transition-colors"
      >
        <X size={14} />
      </button>
    </motion.div>
  )
}
