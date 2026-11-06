import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/utils/cn'
import type { CardView } from '@/utils/ssl/diagram'
import { TONE_BADGE, TONE_CARD } from '../tones'

interface DiagramCardProps {
  title: string
  icon: ReactNode
  view: CardView
}

export function DiagramCard({ title, icon, view }: DiagramCardProps) {
  return (
    <div data-tone={view.tone} className={cn('flex min-w-0 flex-col gap-2 rounded-[10px] border p-3.5', TONE_CARD[view.tone])}>
      <div className="flex items-center gap-2">
        {icon}
        <b className="text-[13px] font-semibold text-nd-text-primary">{title}</b>
        <Badge variant={TONE_BADGE[view.tone]} className="ml-auto">{view.chip}</Badge>
      </div>
      <span className="text-[13px] text-nd-text-primary">{view.sentence}</span>
      {view.detail && <span className="text-xs text-nd-text-muted">{view.detail}</span>}
    </div>
  )
}
