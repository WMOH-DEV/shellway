import type { RemoteDrift, SiteSummary } from '@/types/deploy'
import { commitsBehind, siteBadge, type SiteBadge } from '@/utils/deploy/siteStatus'
import { STACK_LABELS, siteStack } from '@/utils/server/sites/join'
import { Chip, type KitTone } from '../../kit'

const DEPLOY_CHIPS: Record<SiteBadge, { label: string; tone: KitTone }> = {
  live: { label: 'live', tone: 'success' },
  behind: { label: 'new commits', tone: 'info' },
  deploying: { label: 'deploying', tone: 'info' },
  waiting: { label: 'waiting', tone: 'warning' },
  failed: { label: 'failed', tone: 'error' },
  'check-stopped': { label: 'check stopped', tone: 'warning' },
  never: { label: 'not deployed', tone: 'neutral' }
}

export function DeployChip({ summary, pcDrift }: { summary: SiteSummary; pcDrift?: RemoteDrift }) {
  const badge = siteBadge(summary, pcDrift)
  const behind = commitsBehind(summary, pcDrift)
  const { label, tone } = DEPLOY_CHIPS[badge]
  return <Chip dense tone={tone}>{badge === 'behind' && behind ? `${behind} behind` : label}</Chip>
}

export function StackChip({ summary }: { summary: SiteSummary }) {
  return <Chip dense tone="info">{STACK_LABELS[siteStack(summary)]}</Chip>
}
