import type { MouseEvent } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { RemoteDrift } from '@/types/deploy'
import type { ServerRoute } from '@/types/server/core'
import { cn } from '@/utils/cn'
import { shortPath } from '@/utils/deploy/siteRow'
import { siteBadge, timeAgo } from '@/utils/deploy/siteStatus'
import { plainBlock, type SiteEntry } from '@/utils/server/sites/join'
import { httpsView, siteRowAction, siteRuntime, type SiteRowAction } from './model/siteView'
import type { SitesInventory } from '@/utils/server/sites/types'
import { StatusDot } from '../../kit'
import { httpsRoute, siteRoute } from './routes'
import { DeployChip, StackChip } from './siteChips'

export const SITE_GRID = 'grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_auto] gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_150px]'

const ACTION_LABELS: Record<SiteRowAction, string> = {
  cancel: 'Cancel',
  review: 'Review',
  resume: 'Resume',
  'fix-https': 'Fix HTTPS',
  'add-https': 'Add HTTPS',
  deploy: 'Deploy'
}

export interface RowHandlers {
  navigate: (route: ServerRoute) => void
  ship: (name: string) => void
  cancel: (name: string) => void
  resume: (name: string) => void
}

interface SiteListRowProps {
  entry: SiteEntry
  pcDrift?: RemoteDrift
  inventory: SitesInventory | null
  user: string
  now: number
  starting: boolean
  handlers: RowHandlers
}

function aliasText(entry: SiteEntry, user: string): string {
  const others = entry.hosts.filter((h) => h.name !== entry.domain)
  const alias = others.length === 1 && others[0].name === `www.${entry.domain}` ? '+ www' : others.length > 0 ? `+ ${others.length} more` : ''
  return [alias, shortPath(entry.summary.config.path, user)].filter(Boolean).join(' · ')
}

function deploySub(entry: SiteEntry): string {
  const { config, state, history } = entry.summary
  const source = config.sourceMode === 'auto' ? 'auto on server' : 'from my PC'
  const last = history.find((r) => r.trigger !== 'env')
  return last ? `${source} · ${timeAgo(last.finished ?? last.started, state.now)}` : source
}

function runAction(action: SiteRowAction, entry: SiteEntry, badgeFailed: boolean, handlers: RowHandlers): void {
  const { name } = entry.summary.config
  if (action === 'cancel') return handlers.cancel(name)
  if (action === 'resume') return handlers.resume(name)
  if (action === 'review') return badgeFailed ? handlers.navigate(siteRoute(name, 'deployments')) : handlers.ship(name)
  if (action === 'fix-https') return handlers.navigate(siteRoute(name, 'domains'))
  if (action === 'add-https') return handlers.navigate(httpsRoute(plainBlock(entry)?.id, name))
  handlers.ship(name)
}

const stop = (e: MouseEvent) => e.stopPropagation()

export function SiteListRow({ entry, pcDrift, inventory, user, now, starting, handlers }: SiteListRowProps) {
  const { summary } = entry
  const { config, state } = summary
  const badge = siteBadge(summary, pcDrift)
  const action = siteRowAction(entry, badge)
  const https = httpsView(entry, now)
  const runtime = siteRuntime(entry, inventory)
  const urgent = action !== 'deploy' || badge === 'behind'
  const open = () => handlers.navigate(siteRoute(config.name))
  return (
    <div
      role="row"
      onClick={open}
      className={cn('grid cursor-pointer items-center border-b border-nd-border px-4 py-3 last:border-b-0 hover:bg-nd-surface-hover', SITE_GRID)}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[13px] font-medium text-nd-text-primary">{entry.domain ?? config.name}</span>
          <StackChip summary={summary} />
        </div>
        <span className="truncate font-mono text-xs text-nd-text-muted">{aliasText(entry, user)}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <DeployChip summary={summary} pcDrift={pcDrift} />
          <span className="truncate text-[13px] text-nd-text-secondary">{state.currentSubject || 'Nothing live yet'}</span>
        </div>
        <span className="truncate text-xs text-nd-text-muted">{deploySub(entry)}</span>
      </div>
      <div className="hidden min-w-0 flex-col gap-1 lg:flex">
        <span className="flex min-w-0 items-center gap-2 text-[13px] text-nd-text-secondary">
          <StatusDot tone={https.tone} />
          <span className="truncate">{https.label}</span>
        </span>
        <span className="truncate text-xs text-nd-text-muted">{https.sub}</span>
      </div>
      <div className="hidden min-w-0 lg:block">
        <span className="truncate font-mono text-xs text-nd-text-secondary">{runtime ?? '—'}</span>
      </div>
      <div className="flex items-center justify-end gap-1" onClick={stop}>
        <Button size="sm" variant={urgent ? 'primary' : 'secondary'} disabled={starting} onClick={() => runAction(action, entry, badge === 'failed', handlers)}>
          {starting && <Loader2 size={13} className="animate-spin" />}
          {ACTION_LABELS[action]}
        </Button>
        <Button size="icon" variant="ghost" aria-label={`Open ${config.name}`} onClick={open}><ChevronRight size={15} /></Button>
      </div>
    </div>
  )
}
