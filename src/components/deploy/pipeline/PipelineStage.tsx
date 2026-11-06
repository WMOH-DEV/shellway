import type { ReactNode } from 'react'
import { Lock, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/utils/cn'

interface PipelineStageProps {
  icon: LucideIcon
  title: string
  description: string
  locked?: boolean
  last?: boolean
  children: ReactNode
}

export function PipelineStage({ icon: Icon, title, description, locked = false, last = false, children }: PipelineStageProps) {
  return (
    <section className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-3.5">
      <div className="flex flex-col items-center">
        <span className="mt-3 flex h-7 w-7 items-center justify-center rounded-full border border-nd-border bg-nd-bg-tertiary text-nd-info">
          <Icon size={14} />
        </span>
        <span className={cn('mt-1.5 w-px flex-1', last ? 'bg-transparent' : 'bg-nd-border')} />
      </div>
      <div className="mb-3.5 flex flex-col gap-3 rounded-[10px] border border-nd-border bg-nd-bg-secondary px-4 pb-4 pt-3.5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="text-sm font-semibold text-nd-text-primary">{title}</h2>
          <span className="text-xs text-nd-text-muted">{description}</span>
          {locked && (
            <Badge className="ml-auto">
              <Lock size={11} /> Managed by Shellway
            </Badge>
          )}
        </div>
        {children}
      </div>
    </section>
  )
}
