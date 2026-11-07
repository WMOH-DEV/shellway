import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { createSiteApi } from '@/components/deploy/createSite/createSiteApi'
import { HostnameDetail } from '@/components/ssl/HostnameDetail'
import { useCertbotRun } from '@/components/ssl/detail/useCertbotRun'
import { Button } from '@/components/ui/Button'
import type { NameCheck } from '@/types/createSite'
import { cn } from '@/utils/cn'
import { plainBlock, siteCertificate, siteFile, type SiteEntry } from '@/utils/server/sites/join'
import { isIssuableName } from '@/utils/ssl/https/issueCommands'
import { verdictBadge } from '@/utils/ssl/hostRow'
import { useActionLauncher } from '../../../action'
import { Chip, Notice, SectionCard, type KitTone } from '../../../kit'
import { httpsRoute, originRoute, zoneRoute } from '../routes'
import type { SitePageProps } from '../SiteDetailPage'

const TONES: Record<string, KitTone> = { error: 'error', warning: 'warning', success: 'success', neutral: 'neutral' }

export const siteNames = (entry: SiteEntry): string[] => [...new Set(entry.blocks.flatMap((b) => b.names.map((n) => n.toLowerCase())))]

function DnsResult({ check }: { check: NameCheck | string }) {
  if (typeof check === 'string') return <span className="text-xs text-nd-error-fg">{check}</span>
  const records = check.records.map((r) => `${r.type} ${r.content}`).join(', ')
  return (
    <span className="text-xs text-nd-text-muted">
      {records ? `DNS now: ${records}` : 'No DNS record yet. Add one that points at this server.'}
      {check.zone && ` · Cloudflare zone ${check.zone.name}`}
    </span>
  )
}

function AddDomainForm({ page, anchor }: { page: SitePageProps; anchor: string }) {
  const { ctx, data, entry } = page
  const launcher = useActionLauncher(ctx)
  const [domain, setDomain] = useState('')
  const [check, setCheck] = useState<NameCheck | string | null>(null)
  const name = domain.trim().toLowerCase()
  const valid = isIssuableName(name)
  const file = siteFile(entry)

  const checkDns = async () => {
    const result = await createSiteApi().checkName(data.connectionId, name)
    setCheck(result.success && result.data ? result.data : result.error ?? `Could not check ${name}`)
  }

  const add = () => launcher.launch({
    type: 'sites.domain-add',
    params: { vhost: file, anchor, domain: name, certificate: siteCertificate(entry, data.ssl.report) },
    onFinished: () => { setDomain(''); data.refreshAll() }
  })

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          aria-label="New domain"
          placeholder="shop.example.com"
          value={domain}
          onChange={(e) => { setDomain(e.target.value); setCheck(null) }}
          className="h-8 min-w-0 flex-1 rounded-md border border-nd-border-hover bg-nd-bg-sunken px-2.5 font-mono text-[13px] text-nd-text-primary outline-none focus:border-nd-accent"
        />
        <Button size="sm" onClick={() => void checkDns()} disabled={!valid}>Check DNS</Button>
        <Button size="sm" variant="primary" onClick={add} disabled={!valid || !file}><Plus size={13} /> Add domain</Button>
      </div>
      {check && <DnsResult check={check} />}
    </div>
  )
}

function DomainsCard({ page }: { page: SitePageProps }) {
  const { ctx, data, entry } = page
  const launcher = useActionLauncher(ctx)
  const names = siteNames(entry)
  const file = siteFile(entry)
  const anchor = entry.domain ?? names[0]
  const remove = (domain: string) => launcher.launch({
    type: 'sites.domain-remove',
    params: { vhost: file, domain, certificate: siteCertificate(entry, data.ssl.report) },
    onFinished: data.refreshAll
  })

  return (
    <SectionCard title="Domains" count={names.length}>
      {file && <span className="font-mono text-xs text-nd-text-muted">{file}</span>}
      <div className="flex flex-col divide-y divide-nd-border">
        {names.map((name) => {
          const host = entry.hosts.find((h) => h.name === name)
          const badge = host ? verdictBadge(host) : null
          return (
            <div key={name} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-nd-text-primary">{name}</span>
              {name === entry.domain && <Chip dense>primary</Chip>}
              {badge && <Chip dense tone={TONES[badge.tone]}>{badge.label}</Chip>}
              {names.length > 1 && name !== anchor && (
                <Button size="icon" variant="ghost" aria-label={`Remove ${name}`} onClick={() => remove(name)}><X size={14} /></Button>
              )}
            </div>
          )
        })}
      </div>
      {anchor && <AddDomainForm page={page} anchor={anchor} />}
      <p className="text-xs text-nd-text-muted">Adding a name edits the server name lines in the site file, tests the config, reloads, then adds the name to the certificate. You see every command before it runs.</p>
    </SectionCard>
  )
}

function HostPicker({ names, value, onChange }: { names: string[]; value: string; onChange: (name: string) => void }) {
  return (
    <div role="tablist" aria-label="Hostname" className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <button
          key={name}
          type="button"
          role="tab"
          aria-selected={name === value}
          onClick={() => onChange(name)}
          className={cn('h-7 rounded-md border px-2.5 font-mono text-xs', name === value ? 'border-nd-accent bg-nd-surface-raised text-nd-text-primary' : 'border-nd-border text-nd-text-muted hover:text-nd-text-primary')}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

export function DomainsTab({ page }: { page: SitePageProps }) {
  const { ctx, data, entry } = page
  const { report, loading, error, refresh } = data.ssl
  const site = entry.summary.config.name
  const run = useCertbotRun(data.connectionId, () => void refresh())
  const [selected, setSelected] = useState(entry.domain ?? entry.hosts[0]?.name ?? '')
  const host = entry.hosts.find((h) => h.name === selected) ?? entry.hosts[0]
  const plain = plainBlock(entry)

  return (
    <div className="flex flex-col gap-4">
      {entry.blocks.length === 0 && (
        <Notice tone="neutral" title="No web server site found for this folder">
          {report ? `Shellway found no nginx or Apache site whose root is in ${entry.summary.config.path}.` : 'The HTTPS check is still running.'}
        </Notice>
      )}
      {plain && (
        <Notice tone="warning" title="This site has no HTTPS" action={<Button size="sm" variant="primary" onClick={() => ctx.navigate(httpsRoute(plain.id, site))}>Add HTTPS</Button>}>
          Visitors reach it over plain HTTP.
        </Notice>
      )}
      {entry.blocks.length > 0 && <DomainsCard page={page} />}
      {host && report && (
        <>
          {entry.hosts.length > 1 && <HostPicker names={entry.hosts.map((h) => h.name)} value={host.name} onChange={setSelected} />}
          <HostnameDetail
            key={host.name}
            embedded
            connectionId={data.connectionId}
            sessionId={data.sessionId}
            host={host}
            report={report}
            now={data.now}
            loading={loading}
            error={error}
            run={run}
            onBack={() => page.openTab('overview')}
            onAddHttps={(blockId) => ctx.navigate(httpsRoute(blockId, site))}
            onSwitchOrigin={(name) => ctx.navigate(originRoute(name, site))}
            onSetZoneStrict={(zone) => ctx.navigate(zoneRoute(zone, site))}
            onRefresh={refresh}
          />
        </>
      )}
    </div>
  )
}
