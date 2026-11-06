import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import type { SslMode } from '@/types/ssl'
import { modeLabel, type ProbeView } from '@/utils/ssl/zoneMode/zoneModeView'

const CHIP = 'inline-flex min-h-[22px] items-center rounded-md px-2 py-0.5 text-xs font-medium'

const PROBE_CHIP: Record<ProbeView['tone'], string> = {
  success: 'bg-nd-success/12 text-nd-success-fg',
  warning: 'bg-nd-warning/12 text-nd-warning-fg',
  error: 'bg-nd-error/12 text-nd-error-fg'
}

export function ModeChip({ mode }: { mode: SslMode | null }) {
  return <span className={cn(CHIP, 'bg-nd-surface-raised text-nd-text-muted')}>Current mode: {modeLabel(mode)}</span>
}

export function ProbeChip({ view }: { view: ProbeView }) {
  return <span className={cn(CHIP, 'text-left', PROBE_CHIP[view.tone])}>{view.text}</span>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-nd-text-dim">{children}</span>
}
