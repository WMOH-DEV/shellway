import { cn } from '@/utils/cn'
import type { RemoteDrift, SiteSummary } from '@/types/deploy'
import { behindChip, type Chip } from '@/utils/deploy/siteRow'

const CHIP_STYLE: Record<Chip['tone'], string> = {
  info: 'bg-nd-info/[.12] text-nd-info',
  warning: 'bg-nd-warning/[.12] text-nd-warning',
  muted: 'text-nd-text-muted'
}

export function BehindChip({ summary, pcDrift, className }: { summary: SiteSummary; pcDrift?: RemoteDrift; className?: string }) {
  const chip = behindChip(summary, pcDrift)
  if (!chip) return null
  return <span className={cn('shrink-0 rounded px-1.5 py-px text-xs', CHIP_STYLE[chip.tone], className)}>{chip.label}</span>
}
