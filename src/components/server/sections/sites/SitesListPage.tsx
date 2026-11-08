import { useMemo, useRef, useState } from 'react'
import { PageSpinner } from '@/components/ui/Spinner'
import { Globe, Plus, RefreshCw, Rocket, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AwayBanner, ErrorBanner, RunnerBanner, SEARCH_COMBO, useSearchShortcut } from '@/components/deploy/SitesOverview'
import { UnfinishedRunNotice } from '@/components/deploy/createSite/UnfinishedRunNotice'
import { useAwaySummary } from '@/components/deploy/useAwaySummary'
import type { RunRecord } from '@/types/createSite'
import { formatCombo } from '@/utils/keybindings'
import { matchesSiteFilter, matchesSiteSearch, siteFilterCounts, type SiteFilter } from './model/siteView'
import { PageHeader, SectionPage, Segmented, type SegmentOption } from '../../kit'
import type { ServerSectionContext } from '../types'
import { OtherHostnames } from './OtherHostnames'
import { addRoute, createRoute } from './routes'
import { SITE_GRID, SiteListRow, type RowHandlers } from './SiteListRow'
import type { SitesData } from './useSitesData'

interface SitesListPageProps {
  ctx: ServerSectionContext
  data: SitesData
  unfinished: RunRecord | null
  onShip: (name: string) => void
}

const FILTER_LABELS: [SiteFilter, string][] = [
  ['all', 'All'],
  ['attention', 'Needs attention'],
  ['php', 'Laravel / PHP'],
  ['node', 'Node.js'],
  ['static', 'Static'],
  ['docker', 'Docker']
]

const COLUMNS = ['Site', 'Deploy', 'HTTPS', 'Runs', '']

function SearchBox({ query, onChange }: { query: string; onChange: (query: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useSearchShortcut(ref)
  return (
    <label className="flex h-8 w-56 items-center gap-2 rounded-md border border-nd-border-hover bg-nd-bg-sunken px-2.5 text-nd-text-muted focus-within:border-nd-accent">
      <Search size={14} className="shrink-0" />
      <input
        ref={ref}
        aria-label="Search sites"
        placeholder="Search sites"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onChange('')}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-nd-text-primary outline-none placeholder:text-nd-text-muted"
      />
      <kbd className="shrink-0 rounded border border-nd-border px-1 font-mono text-[11px]">{formatCombo(SEARCH_COMBO)}</kbd>
    </label>
  )
}

function EmptySites({ onCreate, onAdd }: { onCreate: () => void; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Rocket size={28} className="text-nd-text-muted" />
      <div className="text-sm text-nd-text-primary">No sites on this server yet</div>
      <div className="max-w-sm text-xs text-nd-text-muted">Create a new site from a template, or add a site that already runs here so Shellway can deploy it.</div>
      <div className="flex items-center gap-2">
        <Button onClick={onAdd}><Plus size={13} /> Add existing site</Button>
        <Button variant="primary" onClick={onCreate}><Globe size={13} /> Create site</Button>
      </div>
    </div>
  )
}

export function SitesListPage({ ctx, data, unfinished, onShip }: SitesListPageProps) {
  const { deploy, join, actions } = data
  const { runner, pcDrift, loading, installing, error } = deploy
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SiteFilter>('all')
  const away = useAwaySummary(data.sessionId, deploy.sites, ctx.active)
  const counts = useMemo(() => siteFilterCounts(join.sites, pcDrift), [join.sites, pcDrift])
  const shown = join.sites.filter((e) => matchesSiteFilter(e, filter, pcDrift[e.summary.config.name]) && matchesSiteSearch(e, query))
  const ready = runner?.installed === true
  const outdated = ready && runner.version !== null && runner.version < runner.bundledVersion
  const options: SegmentOption<SiteFilter>[] = FILTER_LABELS.map(([value, label]) => ({ value, label, count: counts[value], alarm: value === 'attention' }))
  const handlers: RowHandlers = { navigate: ctx.navigate, ship: onShip, cancel: actions.cancel, resume: actions.resume }
  const refreshing = loading || data.ssl.loading

  const headerActions = (
    <>
      {join.sites.length > 0 && <SearchBox query={query} onChange={setQuery} />}
      <Button onClick={data.refreshAll} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} /> Refresh</Button>
      <Button onClick={() => ctx.navigate(addRoute())} disabled={!ready}><Plus size={14} /> Add existing site</Button>
      <Button variant="primary" onClick={() => ctx.navigate(createRoute())} disabled={!ready}><Globe size={14} /> Create site</Button>
    </>
  )

  return (
    <div className="h-full overflow-y-auto bg-nd-bg-primary">
      <SectionPage>
        <PageHeader title="Sites" subtitle="Each site: its domains, code, deploys, HTTPS, workers and logs in one place." actions={headerActions} />
        {runner && (!runner.installed || outdated) && <RunnerBanner installed={runner.installed} installing={installing} onInstall={() => void deploy.installRunner()} />}
        {error && <ErrorBanner message={error} retrying={loading} onRetry={() => void deploy.refresh()} />}
        {unfinished && <UnfinishedRunNotice run={unfinished} onOpen={() => ctx.navigate({ section: 'sites', sub: 'create', params: { run: unfinished.id } })} />}
        {away.summary && <AwayBanner summary={away.summary} onReview={() => setFilter('attention')} onDismiss={away.dismiss} />}
        {!runner && loading && <PageSpinner />}
        {ready && join.sites.length === 0 && !loading && !error && <EmptySites onCreate={() => ctx.navigate(createRoute())} onAdd={() => ctx.navigate(addRoute())} />}
        {join.sites.length > 0 && (
          <>
            <Segmented<SiteFilter> ariaLabel="Filter sites" options={options} value={filter} onChange={setFilter} />
            <div role="table" aria-label="Sites" className="overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
              <div role="row" className={`hidden border-b border-nd-border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-nd-text-dim lg:grid ${SITE_GRID}`}>
                {COLUMNS.map((title, i) => <span key={i} role="columnheader">{title}</span>)}
              </div>
              {shown.map((entry) => (
                <SiteListRow
                  key={entry.summary.config.name}
                  entry={entry}
                  pcDrift={pcDrift[entry.summary.config.name]}
                  inventory={data.inventory}
                  user={data.user}
                  now={data.now}
                  starting={actions.starting.has(entry.summary.config.name)}
                  handlers={handlers}
                />
              ))}
              {shown.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-10 text-[13px] text-nd-text-muted">
                  No sites match
                  <Button size="sm" variant="ghost" onClick={() => { setQuery(''); setFilter('all') }}>Clear search and filter</Button>
                </div>
              )}
            </div>
          </>
        )}
        <OtherHostnames ctx={ctx} data={data} />
      </SectionPage>
    </div>
  )
}
