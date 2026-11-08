import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Label } from './SectionCard'
import { TEXT_TONE, type KitTone } from './tones'

export interface SummaryCell {
  label: string
  value: ReactNode
  meta?: ReactNode
  tone?: KitTone
}

export function SummaryStrip({ cells }: { cells: SummaryCell[] }) {
  return (
    <section className="grid rounded-xl border border-nd-border bg-nd-surface" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
      {cells.map((cell, index) => (
        <div key={cell.label} className={cn('flex min-w-0 flex-col gap-1.5 px-4 py-3.5', index < cells.length - 1 && 'border-r border-nd-border')}>
          <Label>{cell.label}</Label>
          <span className={cn('truncate text-lg font-semibold', cell.tone && cell.tone !== 'neutral' ? TEXT_TONE[cell.tone] : 'text-nd-text-primary')}>{cell.value}</span>
          {cell.meta && <span className="truncate text-xs text-nd-text-muted">{cell.meta}</span>}
        </div>
      ))}
    </section>
  )
}
