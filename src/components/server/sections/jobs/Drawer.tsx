import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Drawer({ title, onClose, footer, children }: { title: string; onClose(): void; footer: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-label={title} className="relative flex h-full w-[460px] max-w-full flex-col border-l border-nd-border bg-nd-bg-secondary">
        <header className="flex items-center gap-2 border-b border-nd-border px-5 py-3.5">
          <h2 className="flex-1 text-[15px] font-semibold text-nd-text-primary">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
            <X size={16} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
        <footer className="flex items-center justify-end gap-2 border-t border-nd-border px-5 py-3">{footer}</footer>
      </aside>
    </div>
  )
}
