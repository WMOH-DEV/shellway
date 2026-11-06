import { cn } from '@/utils/cn'
import type { RunTone } from '@/utils/deploy/siteRow'

const SLOTS = 10

const TONE_STYLE: Record<RunTone, string> = {
  success: 'h-3.5 bg-nd-success',
  warning: 'h-3.5 bg-nd-warning',
  failed: 'h-5 bg-nd-error',
  running: 'h-3.5 bg-nd-info animate-pulse',
  waiting: 'h-3.5 bg-nd-warning',
  cancelled: 'h-3.5 bg-nd-text-muted'
}

export function RunBars({ runs, caption }: { runs: RunTone[]; caption: string }) {
  const empty = SLOTS - runs.length
  const label = runs.length > 0 ? `Last runs, oldest first: ${runs.join(', ')}` : 'No runs yet'
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div role="img" aria-label={label} className="flex h-5 items-end gap-[3px]">
        {Array.from({ length: empty }, (_, i) => <span key={`empty-${i}`} className="h-1.5 w-2 rounded-sm bg-nd-border" />)}
        {runs.map((tone, i) => <span key={i} className={cn('w-2 rounded-sm', TONE_STYLE[tone])} />)}
      </div>
      <span className="truncate text-xs text-nd-text-muted">{caption}</span>
    </div>
  )
}
