import { AlertTriangle, Cloud, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { isDnsBlocked, leftOutByDns, readinessFor } from '@/utils/ssl/addHttps/names'
import { CardLabel } from '../Card'
import { CheckText } from './CheckText'
import type { SiteSelection } from './useSiteSelection'

const COLUMNS = 'grid grid-cols-[28px_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3.5 px-4'

function CloudflareCell({ note }: { note: string | null | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-nd-text-secondary">
      <Cloud size={14} className={cn('shrink-0', note ? 'text-nd-cloudflare' : 'text-nd-text-muted')} aria-hidden />
      <span className="truncate" title={note ?? undefined}>{note ?? '—'}</span>
    </span>
  )
}

function NameRow({ site, name, issuable }: { site: SiteSelection; name: string; issuable: boolean }) {
  const row = readinessFor(site.readiness.data ?? [], name)
  const blocked = isDnsBlocked(site.readiness.data ?? [], name)
  const on = site.selected.includes(name)
  return (
    <label className={cn(COLUMNS, 'border-b border-nd-border py-2.5 last:border-b-0', !issuable && 'opacity-60')}>
      <input
        type="checkbox"
        aria-label={name}
        checked={on}
        disabled={!issuable || blocked}
        onChange={() => site.toggle(name)}
        className="h-[15px] w-[15px] accent-nd-accent"
      />
      <span className={cn('truncate font-mono text-[12.5px]', on ? 'text-nd-text-primary' : 'text-nd-text-muted')}>{name}</span>
      {issuable
        ? <CheckText check={row?.dns} fallback="ok" />
        : <span className="col-span-3 text-[12.5px] text-nd-text-muted">Needs DNS validation, not offered here</span>}
      {issuable && <CheckText check={row?.port80} fallback="—" withIcon={false} />}
      {issuable && <CloudflareCell note={row?.cloudflare} />}
    </label>
  )
}

function LeftOutNotice({ site }: { site: SiteSelection }) {
  const rows = leftOutByDns(site.choices, site.readiness.data ?? [])
  if (rows.length === 0) return null
  return (
    <div role="status" className="flex items-start gap-2.5 bg-nd-warning/[0.07] px-4 py-2.5 text-[12.5px] text-nd-text-secondary">
      <AlertTriangle size={15} className="mt-px shrink-0 text-nd-warning-fg" aria-hidden />
      <span>
        {rows.map((row) => (
          <span key={row.name} className="block">
            <span className="font-mono text-xs">{row.name}</span> {row.dns.detail}, so it's left out. Update its DNS record, then Check again.
          </span>
        ))}
      </span>
    </div>
  )
}

export function NamesCard({ site, fileName }: { site: SiteSelection; fileName: string }) {
  const { readiness } = site
  return (
    <section aria-label="Names" className="overflow-hidden rounded-[10px] border border-nd-border bg-nd-surface">
      <div className="flex items-center gap-2.5 border-b border-nd-border px-4 py-3">
        <CardLabel>Names</CardLabel>
        <span className="text-xs text-nd-text-muted">from <span className="font-mono">server_name</span> in {fileName}</span>
        <div className="flex-1" />
        <Button size="sm" onClick={() => void readiness.reload()} disabled={readiness.loading}>
          <RefreshCw size={13} className={readiness.loading ? 'animate-spin' : undefined} /> Check again
        </Button>
      </div>
      <div className={cn(COLUMNS, 'border-b border-nd-border py-2')} aria-hidden>
        <span />
        {['Name', 'DNS', 'Port 80', 'Cloudflare'].map((title) => <CardLabel key={title}>{title}</CardLabel>)}
      </div>
      {readiness.error && <p role="alert" className="px-4 py-2.5 text-[12.5px] text-nd-error-fg">{readiness.error}</p>}
      {site.choices.map(({ name, issuable }) => <NameRow key={name} site={site} name={name} issuable={issuable} />)}
      <LeftOutNotice site={site} />
    </section>
  )
}
