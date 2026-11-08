import { cn } from '@/utils/cn'
import type { RemoteDrift, SiteSummary } from '@/types/deploy'
import { SITE_COLUMNS, SiteRow, type SiteActions } from './SiteRow'
import { useNowMs } from './useNowMs'

interface SiteListProps {
  sites: SiteSummary[]
  pcDrift: Record<string, RemoteDrift>
  user: string
  starting: ReadonlySet<string>
  actions: SiteActions
}

const COLUMN_TITLES = ['Site', 'Live commit', 'Source', 'Last 10 runs', '']

export function SiteList({ sites, pcDrift, user, starting, actions }: SiteListProps) {
  const nowMs = useNowMs(sites.some((s) => s.state.busy))
  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn('hidden px-4 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-nd-text-dim lg:grid', SITE_COLUMNS)}>
        {COLUMN_TITLES.map((title, i) => <span key={i}>{title}</span>)}
      </div>
      {sites.map((summary) => (
        <SiteRow
          key={summary.config.name}
          summary={summary}
          pcDrift={pcDrift[summary.config.name]}
          user={user}
          nowMs={nowMs}
          starting={starting.has(summary.config.name)}
          actions={actions}
        />
      ))}
    </div>
  )
}
