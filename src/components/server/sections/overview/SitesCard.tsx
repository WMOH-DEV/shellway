import type { ServerRoute } from '@/types/server/core'
import type { DotLabel, SiteRowView } from './model/sites'
import { SectionCard, StatusDot } from '../../kit'

const SHOWN = 6
const ALL_SITES: ServerRoute = { section: 'sites' }

function Dot({ value, kind }: { value: DotLabel; kind: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-nd-text-secondary">
      <StatusDot tone={value.tone} label={`${kind}: ${value.label}`} />
      {value.label}
    </span>
  )
}

function SiteRow({ site, onOpen }: { site: SiteRowView; onOpen(route: ServerRoute): void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen({ section: 'sites', params: { site: site.name } })}
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-nd-border px-4 py-2.5 text-left last:border-b-0 hover:bg-nd-surface-hover"
    >
      <span className="flex min-w-0 flex-col gap-px">
        <span className="truncate font-mono text-[12.5px] text-nd-text-primary">{site.name}</span>
        <span className="truncate font-mono text-xs text-nd-text-muted">{site.path}</span>
      </span>
      <Dot value={site.deploy} kind="Deploy" />
      <Dot value={site.https} kind="HTTPS" />
    </button>
  )
}

export function SitesCard({ sites, loading, error, onOpen }: { sites: SiteRowView[]; loading: boolean; error: string | null; onOpen(route: ServerRoute): void }) {
  const allLink = (
    <button type="button" onClick={() => onOpen(ALL_SITES)} className="text-xs text-nd-accent hover:text-nd-accent-hover">
      All sites
    </button>
  )
  return (
    <SectionCard title="Sites" flush count={sites.length || undefined} aside={allLink}>
      {sites.slice(0, SHOWN).map((site) => <SiteRow key={site.name} site={site} onOpen={onOpen} />)}
      {sites.length === 0 && (
        <p className="px-4 py-5 text-[13px] text-nd-text-muted">
          {error ?? (loading ? 'Reading sites…' : 'No sites yet. Create one to deploy an app.')}
        </p>
      )}
    </SectionCard>
  )
}
