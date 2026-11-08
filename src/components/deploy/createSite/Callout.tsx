import type { ReactNode } from 'react'
import { AlertTriangle, Check, Info } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { Tone } from '@/utils/ssl/tone'
import { TONE_CARD, TONE_TEXT } from '@/components/ssl/tones'

const ICONS: Record<Tone, ReactNode> = {
  error: <AlertTriangle size={15} aria-hidden />,
  warning: <AlertTriangle size={15} aria-hidden />,
  success: <Check size={15} aria-hidden />,
  neutral: <Info size={15} aria-hidden />
}

export function Callout({ tone, icon, children }: { tone: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-2.5 rounded-[10px] border px-3.5 py-2.5', TONE_CARD[tone])}>
      <span className={cn('mt-px shrink-0', TONE_TEXT[tone])}>{icon ?? ICONS[tone]}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] text-nd-text-primary">{children}</div>
    </div>
  )
}
