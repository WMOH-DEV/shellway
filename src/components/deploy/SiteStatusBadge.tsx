import { Badge } from '@/components/ui/Badge'
import type { RemoteDrift, SiteSummary } from '@/types/deploy'
import { commitsBehind, siteBadge, type SiteBadge } from '@/utils/deploy/siteStatus'
import { commitCount } from '@/utils/deploy/siteRow'

const BADGES: Record<SiteBadge, { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'default' | 'accent' }> = {
  live: { label: 'Live', variant: 'success' },
  behind: { label: 'New commit available', variant: 'info' },
  deploying: { label: 'Deploying', variant: 'info' },
  waiting: { label: 'Waiting for approval', variant: 'warning' },
  failed: { label: 'Last deploy failed', variant: 'error' },
  'check-stopped': { label: 'Auto check stopped', variant: 'warning' },
  never: { label: 'Not deployed yet', variant: 'default' }
}

function badgeLabel(kind: SiteBadge, behind: number | null): string {
  if (kind !== 'behind' || !behind) return BADGES[kind].label
  return `${commitCount(behind)} behind`
}

export function SiteStatusBadge({ summary, pcDrift, className }: { summary: SiteSummary; pcDrift?: RemoteDrift; className?: string }) {
  const kind = siteBadge(summary, pcDrift)
  return (
    <Badge variant={BADGES[kind].variant} className={className}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {badgeLabel(kind, commitsBehind(summary, pcDrift))}
    </Badge>
  )
}
