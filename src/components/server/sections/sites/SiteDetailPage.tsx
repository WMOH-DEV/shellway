import { ArrowLeft, ExternalLink, KeyRound, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react'
import { CancelButton, DeployButton, type DetailActions } from '@/components/deploy/detail/DetailHeader'
import { SiteRunModals, useSiteRuns, type SiteRuns } from '@/components/deploy/detail/useSiteRuns'
import { useServerCheck, type ServerCheckState } from '@/components/deploy/useServerCheck'
import { Button } from '@/components/ui/Button'
import { Dropdown } from '@/components/ui/Dropdown'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/utils/cn'
import { rollbackTarget } from '@/utils/deploy/siteDetail'
import { shortSha } from '@/utils/deploy/siteStatus'
import { plainBlock, type SiteEntry } from '@/utils/server/sites/join'
import { hasHttpsRisk, siteRuntime } from './model/siteView'
import { Chip } from '../../kit'
import type { ServerSectionContext } from '../types'
import { httpsRoute, keyRoute, SITE_TABS, siteRoute, siteTab, sitesRoute, type SiteTab } from './routes'
import { DeployChip, StackChip } from './siteChips'
import { SiteTabBody } from './SiteTabBody'
import type { SitesData } from './useSitesData'
import type { CreateRuns } from './useCreateRuns'

export interface SitePageProps {
  ctx: ServerSectionContext
  data: SitesData
  entry: SiteEntry
  runs: SiteRuns
  check: ServerCheckState
  createRuns: CreateRuns
  openTab: (tab: SiteTab) => void
  onShip: () => void
}

interface SiteDetailPageProps {
  ctx: ServerSectionContext
  data: SitesData
  entry: SiteEntry
  createRuns: CreateRuns
  onShip: (name: string) => void
}

function TabBar({ tab, flagged, onChange }: { tab: SiteTab; flagged: ReadonlySet<SiteTab>; onChange: (tab: SiteTab) => void }) {
  return (
    <div role="tablist" aria-label="Site sections" className="flex gap-5 overflow-x-auto border-b border-nd-border">
      {SITE_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onChange(t.id)}
          className={cn('-mb-px whitespace-nowrap border-b-2 px-0.5 py-2.5 text-[13px]', tab === t.id ? 'border-nd-accent font-medium text-nd-text-primary' : 'border-transparent text-nd-text-muted hover:text-nd-text-secondary')}
        >
          {t.label}
          {flagged.has(t.id) && <span aria-label="has a problem" className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-nd-warning align-middle" />}
        </button>
      ))}
    </div>
  )
}

function Header({ ctx, data, entry, runs, onShip }: Pick<SitePageProps, 'ctx' | 'data' | 'entry' | 'runs' | 'onShip'>) {
  const { summary, domain } = entry
  const { config, state } = summary
  const pcDrift = data.deploy.pcDrift[config.name]
  const starting = data.actions.starting.has(config.name)
  const rollbackTo = rollbackTarget(summary)
  const runtime = siteRuntime(entry, data.inventory)
  const plain = plainBlock(entry)
  const actions: DetailActions = {
    back: () => ctx.navigate(sitesRoute()),
    deploy: runs.followNewest(onShip),
    deployNow: runs.followNewest(() => data.actions.deployNow(config.name)),
    cancel: () => data.actions.cancel(config.name),
    rollback: runs.askRollback,
    keySetup: () => ctx.navigate(keyRoute(config.name)),
    remove: () => runs.askRemove(true)
  }
  const menu = [
    ...(config.sourceMode === 'auto' ? [{ id: 'key', label: 'Deploy key', icon: <KeyRound size={13} /> }] : []),
    { id: 'remove', label: 'Remove site', icon: <Trash2 size={13} />, danger: true }
  ]
  return (
    <header className="flex flex-wrap items-center gap-2.5">
      <Button size="icon" variant="ghost" aria-label="Back to sites" onClick={actions.back}><ArrowLeft size={16} /></Button>
      <button type="button" onClick={actions.back} className="text-[13px] text-nd-text-muted hover:text-nd-text-primary">Sites</button>
      <span className="text-nd-text-muted">/</span>
      <h1 className="truncate font-mono text-[19px] font-semibold tracking-[-0.01em] text-nd-text-primary">{domain ?? config.name}</h1>
      <StackChip summary={summary} />
      {runtime && <Chip dense mono>{runtime}</Chip>}
      <DeployChip summary={summary} pcDrift={pcDrift} />
      {plain && (
        <button type="button" onClick={() => ctx.navigate(httpsRoute(plain.id, config.name))} className="rounded bg-nd-warning/12 px-1.5 py-px text-xs text-nd-warning-fg hover:bg-nd-warning/20">
          No HTTPS · Add
        </button>
      )}
      <div className="flex-1" />
      {domain && (
        <a href={`https://${domain}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-nd-border px-3 text-[13px] text-nd-text-secondary hover:bg-nd-surface-hover">
          <ExternalLink size={14} /> Open site
        </a>
      )}
      {rollbackTo && (
        <Tooltip content={`Roll back to ${shortSha(rollbackTo.commit)}`}>
          <Button onClick={() => actions.rollback(rollbackTo)} disabled={state.busy || starting}><RotateCcw size={14} /> Rollback</Button>
        </Tooltip>
      )}
      {state.busy
        ? <CancelButton summary={summary} starting={starting} onCancel={actions.cancel} />
        : <DeployButton summary={summary} pcDrift={pcDrift} starting={starting} actions={actions} />}
      <Dropdown
        align="right"
        trigger={<Button size="icon" variant="ghost" aria-label="More site actions"><MoreHorizontal size={16} /></Button>}
        items={menu}
        onSelect={(id) => (id === 'key' ? actions.keySetup() : actions.remove())}
      />
    </header>
  )
}

export function SiteDetailPage({ ctx, data, entry, createRuns, onShip }: SiteDetailPageProps) {
  const { config } = entry.summary
  const tab = siteTab(ctx.route.params?.tab)
  const openTab = (next: SiteTab) => ctx.navigate(siteRoute(config.name, next === 'overview' ? undefined : next))
  const runs = useSiteRuns(data.connectionId, config, () => openTab('deployments'), () => {
    ctx.navigate(sitesRoute())
    void data.deploy.refresh()
  })
  const check = useServerCheck(data.connectionId, config)
  const flagged = new Set<SiteTab>([...(hasHttpsRisk(entry) ? ['domains' as const] : []), ...(check.hasProblem ? ['settings' as const] : [])])
  const page: SitePageProps = { ctx, data, entry, runs, check, createRuns, openTab, onShip: () => onShip(config.name) }
  return (
    <div className="flex h-full flex-col overflow-hidden bg-nd-bg-primary">
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-7 pb-5 pt-[22px]">
        <Header {...page} />
        <TabBar tab={tab} flagged={flagged} onChange={openTab} />
        <div className="min-h-0 flex-1">
          <SiteTabBody tab={tab} page={page} />
        </div>
      </div>
      <SiteRunModals config={config} runs={runs} />
    </div>
  )
}
