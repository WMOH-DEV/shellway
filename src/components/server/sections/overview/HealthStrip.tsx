import { cn } from '@/utils/cn'
import type { HealthCell } from './model/health'
import { DOT_TONE, Label, TEXT_TONE } from '../../kit'

const PLACEHOLDER_LABELS = ['CPU', 'Memory', 'Disk', 'Network']

function Cell({ cell, last }: { cell: HealthCell; last: boolean }) {
  const valueTone = cell.tone === 'warning' || cell.tone === 'error' ? TEXT_TONE[cell.tone] : 'text-nd-text-primary'
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 px-4 py-3.5', !last && 'border-r border-nd-border')}>
      <div className="flex items-baseline gap-2">
        <Label>{cell.label}</Label>
        <span className={cn('ml-auto text-lg font-semibold', valueTone)}>{cell.value}</span>
      </div>
      <div className="flex h-1 overflow-hidden rounded-sm bg-nd-surface-raised" role="meter" aria-label={cell.label} aria-valuenow={Math.round(cell.percent)} aria-valuemin={0} aria-valuemax={100}>
        <span className={cn('h-full', DOT_TONE[cell.tone])} style={{ width: `${cell.percent}%` }} />
      </div>
      <span className="truncate text-xs text-nd-text-muted">{cell.meta}</span>
    </div>
  )
}

function Placeholder({ label, last }: { label: string; last: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2 px-4 py-3.5', !last && 'border-r border-nd-border')}>
      <div className="flex items-baseline gap-2">
        <Label>{label}</Label>
        <span className="ml-auto text-lg font-semibold text-nd-text-muted">—</span>
      </div>
      <div className="h-1 rounded-sm bg-nd-surface-raised" />
      <span className="text-xs text-nd-text-muted">Reading…</span>
    </div>
  )
}

export function HealthStrip({ cells }: { cells: HealthCell[] | null }) {
  return (
    <section aria-label="Health" className="grid grid-cols-4 rounded-xl border border-nd-border bg-nd-surface">
      {cells
        ? cells.map((cell, index) => <Cell key={cell.key} cell={cell} last={index === cells.length - 1} />)
        : PLACEHOLDER_LABELS.map((label, index) => <Placeholder key={label} label={label} last={index === PLACEHOLDER_LABELS.length - 1} />)}
    </section>
  )
}
