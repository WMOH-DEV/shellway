import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/utils/cn'
import { CALLOUT_TONE, TEXT_TONE, type KitTone } from './tones'

const ICONS: Record<KitTone, ReactNode> = {
  success: <CheckCircle2 size={15} aria-hidden />,
  warning: <AlertTriangle size={15} aria-hidden />,
  error: <XCircle size={15} aria-hidden />,
  info: <Info size={15} aria-hidden />,
  neutral: <Info size={15} aria-hidden />
}

export function Notice({ tone, title, action, children }: { tone: KitTone; title?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5', CALLOUT_TONE[tone])}>
      <span className={cn('mt-px shrink-0', TEXT_TONE[tone])}>{ICONS[tone]}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] text-nd-text-primary">
        {title && <span className="font-medium">{title}</span>}
        {children && <div className="text-nd-text-secondary">{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}
