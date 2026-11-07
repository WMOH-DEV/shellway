import type { ReactNode } from 'react'
import { AlertTriangle, ArrowUp, CheckCircle2, X } from 'lucide-react'
import type { AttentionItem, AttentionLevel, ServerRoute } from '@/types/server/core'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/utils/cn'
import { worstLevel } from '@/utils/server/overview/attention'
import { CHIP_TONE, Chip, SectionCard } from '../../kit'

const LEVEL_ICONS: Record<AttentionLevel, ReactNode> = {
  error: <X size={13} aria-hidden />,
  warning: <AlertTriangle size={12} aria-hidden />,
  info: <ArrowUp size={13} aria-hidden />
}

function AttentionRow({ item, onOpen }: { item: AttentionItem; onOpen(route: ServerRoute): void }) {
  return (
    <div className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-3 border-b border-nd-border px-4 py-3 last:border-b-0 hover:bg-nd-surface-hover">
      <span className={cn('flex h-[22px] w-[22px] items-center justify-center rounded-full', CHIP_TONE[item.level])} role="img" aria-label={item.level}>{LEVEL_ICONS[item.level]}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-nd-text-primary">{item.title}</span>
        <span className="truncate text-xs text-nd-text-muted">{item.detail}</span>
      </div>
      <Button size="sm" variant="secondary" onClick={() => onOpen(item.route)}>{item.actionLabel}</Button>
    </div>
  )
}

function EmptyState({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-nd-text-muted">
        <Spinner size="sm" />
        Checking the server…
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-nd-text-muted">
      <CheckCircle2 size={15} className="text-nd-success-fg" aria-hidden />
      Nothing needs attention
    </div>
  )
}

export function AttentionList({ items, loading, onOpen }: { items: AttentionItem[]; loading: boolean; onOpen(route: ServerRoute): void }) {
  const worst = worstLevel(items)
  return (
    <SectionCard
      title="Needs attention"
      flush
      count={worst && <Chip tone={worst} dense>{items.length}</Chip>}
      aside={items.length > 1 && <span className="text-xs text-nd-text-muted">sorted by impact</span>}
    >
      {items.length === 0 ? <EmptyState loading={loading} /> : items.map((item) => <AttentionRow key={item.id} item={item} onOpen={onOpen} />)}
    </SectionCard>
  )
}
