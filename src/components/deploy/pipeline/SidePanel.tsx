import type { ReactNode } from 'react'
import { Toggle } from '@/components/ui/Toggle'
import { cn } from '@/utils/cn'

export function SidePanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-nd-border bg-nd-surface px-4 py-3.5">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-nd-text-muted">{title}</h3>
      {children}
    </div>
  )
}

interface SwitchRowProps {
  checked: boolean
  onChange: (checked: boolean) => void
  title: string
  hint: string
  disabled?: boolean
}

export function SwitchRow({ checked, onChange, title, hint, disabled = false }: SwitchRowProps) {
  return (
    <div className={cn('flex items-start gap-2.5', disabled && 'opacity-60')}>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} className="mt-px" />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-nd-text-primary">{title}</span>
        <span className="text-xs text-nd-text-muted">{hint}</span>
      </div>
    </div>
  )
}
