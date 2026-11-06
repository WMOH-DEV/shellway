import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { AlertTriangle, Clock, Loader2, Plus, RefreshCw, Rocket, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { formatCombo, matchesKeyCombo } from '@/utils/keybindings'
import { awayParts, filterCounts, matchesFilter, matchesSearch, type AwayOutcome, type AwaySummary, type SiteFilter } from '@/utils/deploy/siteRow'
import type { DeploySites } from './useDeploySites'
import { SiteList } from './SiteList'
import type { SiteActions } from './SiteRow'

const SEARCH_COMBO = 'CmdOrCtrl+K'

const FILTERS: { id: SiteFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'auto', label: 'Auto on server' },
  { id: 'pc', label: 'From my PC' }
]

export interface OverviewFilters {
  query: string
  filter: SiteFilter
  setQuery: (query: string) => void
  setFilter: (filter: SiteFilter) => void
}

interface SitesOverviewProps {
  data: DeploySites
  filters: OverviewFilters
  away: { summary: AwaySummary | null; dismiss: () => void }
  serverName: string
  user: string
  starting: ReadonlySet<string>
  actions: SiteActions
  onAdd: () => void
}

function isOtherEditable(target: EventTarget | null, own: HTMLElement | null): boolean {
  if (!(target instanceof HTMLElement) || target === own) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function useSearchShortcut(inputRef: RefObject<HTMLInputElement>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = inputRef.current
      if (!input || input.offsetParent === null || !matchesKeyCombo(e, SEARCH_COMBO)) return
      if (isOtherEditable(e.target, input)) return
      e.preventDefault()
      input.focus()
      input.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inputRef])
}

function subtitle(data: DeploySites, serverName: string): string {
  const { runner, sites, error } = data
  if (!runner) return error ? `Could not reach ${serverName}` : `Checking ${serverName}…`
  if (!runner.installed) return `Deploy runner not installed on ${serverName}`
  const outdated = runner.version !== null && runner.version < runner.bundledVersion
  const count = `${sites.length} site${sites.length === 1 ? '' : 's'} on ${serverName}`
  return `${count} · ${outdated ? 'runner update available' : 'runner installed'}`
}

function RunnerBanner({ installed, installing, onInstall }: { installed: boolean; installing: boolean; onInstall: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-nd-info/30 bg-nd-info/[0.07] px-3.5 py-2.5">
      <AlertTriangle size={15} className="shrink-0 text-nd-info-fg" />
      <div className="flex-1 text-[13px] text-nd-text-primary">
        {installed
          ? 'A newer deploy runner is available for this server.'
          : 'Shellway installs a small deploy script on this server, in ~/.shellway-deploy. It never touches anything outside that folder and your sites.'}
      </div>
      <Button size="sm" variant="primary" onClick={onInstall} disabled={installing}>
        {installing ? 'Installing…' : installed ? 'Update' : 'Install'}
      </Button>
    </div>
  )
}

function ErrorBanner({ message, retrying, onRetry }: { message: string; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-nd-error/30 bg-nd-error/[0.07] px-3.5 py-2.5 text-[13px] text-nd-text-primary">
      <AlertTriangle size={15} className="shrink-0 text-nd-error-fg" />
      <span className="flex-1">{message}</span>
      <Button size="sm" onClick={onRetry} disabled={retrying}>Try again</Button>
    </div>
  )
}

const OUTCOME_STYLE: Record<Exclude<AwayOutcome['tone'], 'plain'>, string> = {
  error: 'text-nd-error-fg',
  warning: 'text-nd-warning-fg'
}

function AwayBanner({ summary, onReview, onDismiss }: { summary: AwaySummary; onReview: () => void; onDismiss: () => void }) {
  const { runs, outcomes } = awayParts(summary)
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-nd-border bg-nd-surface py-2.5 pl-3.5 pr-3">
      <Clock size={16} className="shrink-0 text-nd-text-muted" />
      <span className="text-[13px] text-nd-text-secondary">
        While you were away, <b className="font-semibold text-nd-text-primary">{runs}</b> ran on this server
        {outcomes.length > 0 && ': '}
        {outcomes.map((o, i) => (
          <span key={o.text}>
            {i > 0 && ', '}
            {o.tone === 'plain' ? o.text : <b className={cn('font-semibold', OUTCOME_STYLE[o.tone])}>{o.text}</b>}
          </span>
        ))}
        .
      </span>
      <div className="ml-auto flex items-center gap-1">
        {summary.failed + summary.waiting > 0 && <Button size="sm" onClick={onReview}>Review</Button>}
        <Button size="icon" variant="ghost" aria-label="Dismiss" className="h-7 w-7" onClick={onDismiss}><X size={14} /></Button>
      </div>
    </div>
  )
}

function FilterBar({ value, counts, onChange }: { value: SiteFilter; counts: Record<SiteFilter, number>; onChange: (f: SiteFilter) => void }) {
  return (
    <div role="tablist" aria-label="Filter sites" className="flex w-fit flex-wrap items-center gap-1 rounded-lg border border-nd-border bg-nd-bg-sunken p-[3px]">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={value === f.id}
          onClick={() => onChange(f.id)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors',
            value === f.id ? 'bg-nd-surface-raised text-nd-text-primary' : 'text-nd-text-muted hover:text-nd-text-primary'
          )}
        >
          {f.label}
          <span className={cn(f.id === 'attention' && counts.attention > 0 ? 'text-nd-error-fg' : 'text-nd-text-muted')}>{counts[f.id]}</span>
        </button>
      ))}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <Rocket size={28} className="text-nd-text-muted" />
      <div className="text-sm text-nd-text-primary">No sites on this server yet</div>
      <div className="max-w-sm text-xs text-nd-text-muted">
        Add a site to deploy it with one click, or automatically when you push. You write the commands; Shellway remembers them.
      </div>
      <Button variant="primary" onClick={onAdd}><Plus size={13} /> Add site</Button>
    </div>
  )
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-[13px] text-nd-text-muted">
      No sites match
      <Button size="sm" variant="ghost" onClick={onClear}>Clear search and filter</Button>
    </div>
  )
}

export function SitesOverview({ data, filters, away, serverName, user, starting, actions, onAdd }: SitesOverviewProps) {
  const { runner, sites, pcDrift, loading, installing, error, refresh, installRunner } = data
  const { query, filter, setQuery, setFilter } = filters
  const searchRef = useRef<HTMLInputElement>(null)
  useSearchShortcut(searchRef)

  const counts = useMemo(() => filterCounts(sites, pcDrift), [sites, pcDrift])
  const shown = useMemo(
    () => sites.filter((s) => matchesFilter(s, filter, pcDrift[s.config.name]) && matchesSearch(s, query)),
    [sites, pcDrift, filter, query]
  )
  const outdated = runner?.installed && runner.version !== null && runner.version < runner.bundledVersion
  const clear = () => { setQuery(''); setFilter('all') }

  return (
    <div className="h-full overflow-y-auto bg-nd-bg-primary">
      <div className="mx-auto flex min-h-full w-full max-w-[1400px] flex-col gap-4 px-7 pb-7 pt-5">
        <header className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="text-lg font-semibold tracking-tight text-nd-text-primary">Deploy</h1>
            <p className="truncate text-[13px] text-nd-text-muted">{subtitle(data, serverName)}</p>
          </div>
          <div className="flex-1" />
          {sites.length > 0 && (
            <label className="flex h-8 w-60 items-center gap-2 rounded-md border border-nd-border-hover bg-nd-bg-sunken px-2.5 text-nd-text-muted focus-within:border-nd-accent">
              <Search size={14} className="shrink-0" />
              <input
                ref={searchRef}
                aria-label="Search sites"
                placeholder="Search sites"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-nd-text-primary outline-none placeholder:text-nd-text-muted"
              />
              <kbd className="shrink-0 rounded border border-nd-border px-1 font-mono text-[11px]">{formatCombo(SEARCH_COMBO)}</kbd>
            </label>
          )}
          <Button onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Refresh
          </Button>
          {runner?.installed && <Button variant="primary" onClick={onAdd}><Plus size={14} /> Add site</Button>}
        </header>

        {runner && (!runner.installed || outdated) && <RunnerBanner installed={runner.installed} installing={installing} onInstall={() => void installRunner()} />}
        {error && <ErrorBanner message={error} retrying={loading} onRetry={() => void refresh()} />}
        {away.summary && <AwayBanner summary={away.summary} onReview={() => setFilter('attention')} onDismiss={away.dismiss} />}

        {!runner && loading && (
          <div className="flex flex-1 items-center justify-center py-16 text-nd-text-muted"><Loader2 size={20} className="animate-spin" /></div>
        )}
        {runner?.installed && sites.length === 0 && !loading && !error && <EmptyState onAdd={onAdd} />}
        {sites.length > 0 && (
          <>
            <FilterBar value={filter} counts={counts} onChange={setFilter} />
            {shown.length > 0
              ? <SiteList sites={shown} pcDrift={pcDrift} user={user} starting={starting} actions={actions} />
              : <NoMatches onClear={clear} />}
          </>
        )}
      </div>
    </div>
  )
}
