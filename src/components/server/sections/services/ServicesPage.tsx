import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/utils/cn'
import type { ServerFacts } from '@/types/server/core'
import { failureLines, findHint, type HintFix } from '@/utils/server/services/hints'
import { buildServiceList, filterCounts, filterServices, probeData, type ControlVerb, type ServiceFilter, type ServiceItem } from '@/utils/server/services/list'
import { LIST_PROBE_IDS, PROBE } from '@/utils/server/services/probes'
import type { ContainersData, FailedDetails, SiteUsage } from '@/utils/server/services/types'
import { sitesUsing } from '@/utils/server/services/usage'
import { useActionLauncher } from '../../action'
import { Label, Notice, PageHeader, ProbeState, SectionPage, Segmented, type SegmentOption } from '../../kit'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'
import { FailurePanel } from './FailurePanel'
import { LogDrawer } from './LogDrawer'
import { ROW_GRID, ServiceRow } from './ServiceRow'

const FILTER_LABEL: Record<ServiceFilter, string> = { all: 'All', failed: 'Failed', systemd: 'System', supervisor: 'Supervisor', pm2: 'pm2', container: 'Containers' }

const PARTIAL_SOURCES: { id: string; label: string }[] = [
  { id: PROBE.supervisor, label: 'Supervisor programs' },
  { id: PROBE.pm2Users, label: 'pm2 apps of other users' },
  { id: PROBE.failed, label: 'Failure details' }
]

function missingSources(facts: ServerFacts): string[] {
  const notes = PARTIAL_SOURCES.flatMap(({ id, label }) => {
    const result = facts[id]
    if (result?.status === 'unavailable') return [`${label}: ${result.reason}`]
    return result?.status === 'error' ? [`${label}: ${result.error}`] : []
  })
  const containers = probeData<ContainersData>(facts, PROBE.containers)
  return containers?.installed && containers.access === null ? [...notes, 'Containers: this login is not in the docker group and cannot use sudo.'] : notes
}

function withSites(item: ServiceItem, sites: string[]): string {
  if (sites.length === 0) return item.detail
  return [item.detail, `${sites.length} ${sites.length === 1 ? 'site' : 'sites'}`].filter(Boolean).join(' · ')
}

export function ServicesPage({ ctx }: { ctx: ServerSectionContext }) {
  const { facts, loading, refresh } = useServerFacts(ctx, LIST_PROBE_IDS)
  const launcher = useActionLauncher(ctx)
  const items = useMemo(() => buildServiceList(facts), [facts])
  const failed = probeData<FailedDetails>(facts, PROBE.failed)
  const usage = probeData<SiteUsage>(facts, PROBE.usage)
  const targetId = ctx.route.params?.id ?? null
  const [filter, setFilter] = useState<ServiceFilter>('all')
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [logsFor, setLogsFor] = useState<ServiceItem | null>(null)
  const targetRef = useRef<HTMLDivElement>(null)
  const hasTarget = items.some((item) => item.id === targetId)

  useEffect(() => {
    if (!targetId) return
    setFilter('all')
    setQuery('')
  }, [targetId])

  useEffect(() => {
    if (hasTarget) targetRef.current?.scrollIntoView({ block: 'center' })
  }, [hasTarget, targetId])

  const counts = useMemo(() => filterCounts(items), [items])
  const shown = useMemo(() => filterServices(items, filter, query), [items, filter, query])
  const options: SegmentOption<ServiceFilter>[] = (Object.keys(FILTER_LABEL) as ServiceFilter[]).map((value) => ({ value, label: FILTER_LABEL[value], count: counts[value], alarm: value === 'failed' }))
  const notes = missingSources(facts)

  const launch = (type: string, params: unknown) => launcher.launch({ type, params, onFinished: () => void refresh() })
  const runVerb = (item: ServiceItem, verb: ControlVerb) => launch('services.control', { kind: item.kind, name: item.name, verb, user: item.user })
  const toggleOpen = (id: string) => setCollapsed((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })

  const applyFix = (item: ServiceItem, fix: HintFix) => {
    if (fix.kind === 'control') launch('services.control', fix.params)
    else if (fix.kind === 'fix') launch('services.fix', fix.params)
    else if (fix.kind === 'route') ctx.navigate(fix.route)
    else if (fix.kind === 'logs') setLogsFor(item)
  }

  const renderRow = (item: ServiceItem) => {
    const sites = item.kind === 'systemd' ? sitesUsing(usage, item.name) : []
    const lines = failureLines(item, failed)
    return (
      <ServiceRow
        key={item.id}
        ref={item.id === targetId ? targetRef : undefined}
        item={item}
        detail={withSites(item, sites)}
        open={item.state === 'failed' && !collapsed.has(item.id)}
        highlighted={item.id === targetId}
        onToggleOpen={() => toggleOpen(item.id)}
        onVerb={(verb) => runVerb(item, verb)}
        onLogs={() => setLogsFor(item)}
      >
        <FailurePanel lines={lines} hint={findHint({ item, lines, failed })} usedBy={sites} onFix={(fix) => applyFix(item, fix)} />
      </ServiceRow>
    )
  }

  return (
    <SectionPage>
      <PageHeader
        title="Services"
        subtitle="Everything that runs in the background: systemd services, pm2 apps, Supervisor workers and containers."
        actions={
          <>
            <div className="w-56"><Input aria-label="Search services" placeholder="Search" icon={<Search size={14} />} value={query} onChange={(event) => setQuery(event.target.value)} /></div>
            <Button variant="secondary" onClick={() => ctx.navigate({ section: 'services', sub: 'logs' })}><FileText size={14} className="mr-1.5" />Server logs</Button>
            <Button variant="ghost" size="icon" aria-label="Refresh services" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} className={cn(loading && 'animate-spin')} /></Button>
          </>
        }
      />
      <Segmented<ServiceFilter> ariaLabel="Filter services" options={options} value={filter} onChange={setFilter} />
      {notes.length > 0 && (
        <Notice tone="neutral" title="Some services could not be read">
          <ul className="flex flex-col gap-0.5">{notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </Notice>
      )}
      <ProbeState result={facts[PROBE.systemd]} label="services">
        {() => (
          <section aria-label="Services list" className="overflow-hidden rounded-xl border border-nd-border bg-nd-surface">
            <div className={cn(ROW_GRID, 'border-b border-nd-border py-2.5')}>
              <span /><Label>Name</Label><Label>Kind</Label><Label>Status</Label><Label>CPU</Label><Label>Memory</Label><Label>On boot</Label><span />
            </div>
            {shown.map(renderRow)}
            {shown.length === 0 && <p className="px-4 py-6 text-[13px] text-nd-text-muted">{items.length === 0 ? 'No services found.' : 'Nothing matches this filter.'}</p>}
          </section>
        )}
      </ProbeState>
      <LogDrawer ctx={ctx} item={logsFor} onClose={() => setLogsFor(null)} />
    </SectionPage>
  )
}
