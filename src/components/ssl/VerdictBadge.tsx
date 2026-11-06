import { Badge } from '@/components/ui/Badge'
import type { VerdictBadgeView } from '@/utils/ssl/hostRow'
import { TONE_BADGE } from './tones'

export function VerdictBadge({ view, className }: { view: VerdictBadgeView; className?: string }) {
  return (
    <Badge variant={TONE_BADGE[view.tone]} className={className}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {view.label}
    </Badge>
  )
}
