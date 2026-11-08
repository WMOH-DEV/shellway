import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/utils/cn'

export type CalloutTone = 'success' | 'warning' | 'error'

const FRAME: Record<CalloutTone, string> = {
  success: 'border-nd-success/30 bg-nd-success/[0.07]',
  warning: 'border-nd-warning/30 bg-nd-warning/[0.07]',
  error: 'border-nd-error/30 bg-nd-error/[0.07]'
}

const ICON_COLOR: Record<CalloutTone, string> = {
  success: 'text-nd-success-fg',
  warning: 'text-nd-warning-fg',
  error: 'text-nd-error-fg'
}

const ICONS = { success: CheckCircle2, warning: AlertTriangle, error: XCircle }

interface CalloutProps {
  tone: CalloutTone
  role?: 'alert' | 'status'
  children: ReactNode
}

export function Callout({ tone, role, children }: CalloutProps) {
  const Icon = ICONS[tone]
  return (
    <div role={role} className={cn('flex flex-col gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px] text-nd-text-primary', FRAME[tone])}>
      <div className="flex items-start gap-2.5">
        <Icon size={15} className={cn('mt-px shrink-0', ICON_COLOR[tone])} aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">{children}</div>
      </div>
    </div>
  )
}
