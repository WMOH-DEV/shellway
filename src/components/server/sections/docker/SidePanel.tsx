import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function SidePanel({ title, label, aside, footer, onClose, children }: { title: ReactNode; label: string; aside?: ReactNode; footer?: ReactNode; onClose(): void; children: ReactNode }) {
  return (
    <aside aria-label={label} className="flex h-full w-[440px] shrink-0 flex-col border-l border-nd-border bg-nd-bg-secondary">
      <div className="flex items-center gap-2 border-b border-nd-border px-5 py-3.5">
        <h2 className="min-w-0 truncate text-[15px] font-semibold text-nd-text-primary">{title}</h2>
        <div className="flex-1" />
        {aside}
        <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1.5 text-nd-text-muted hover:bg-nd-surface-hover hover:text-nd-text-primary">
          <X size={16} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex items-center gap-2 border-t border-nd-border px-5 py-3">{footer}</div>}
    </aside>
  )
}
