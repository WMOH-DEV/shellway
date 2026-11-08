import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { BehindChip } from '@/components/deploy/BehindChip'
import { RunBars } from '@/components/deploy/RunBars'
import { Button } from '@/components/ui/Button'
import type { DeployRecord } from '@/types/deploy'
import { liveCaption, recordTitle, runStatus, type RunStatusTone } from '@/utils/deploy/siteDetail'
import { recentRuns, runsCaption, sourceMeta, triggerLabel } from '@/utils/deploy/siteRow'
import { duration, shortSha, timeAgo } from '@/utils/deploy/siteStatus'
import { plainBlock, worstHost } from '@/utils/server/sites/join'
import { logSources } from '@/utils/server/sites/logSources'
import { hasHttpsRisk } from '../model/siteView'
import { certView, edgeView, verdictHeadline } from '@/utils/ssl/hostRow'
import { Chip, SectionCard, Segmented, StatusDot, type KitTone } from '../../../kit'
import { httpsRoute } from '../routes'
import type { SitePageProps } from '../SiteDetailPage'
import { siteNames } from './DomainsTab'
import { LogText } from './LogText'
import { useSiteJobs } from './useSiteJobs'
import { useSiteLog } from './useSiteLog'
import { JobRows, jobsRoute } from './WorkersTab'

const RECENT = 3
const TAIL_LINES = 8

const RUN_TONES: Record<RunStatusTone, KitTone> = { success: 'success', warning: 'warning', error: 'error', info: 'info', muted: 'neutral' }

function DeployCard({ page }: { page: SitePageProps }) {
  const { data, entry } = page
  const { summary } = entry
  const { config, state } = summary
  return (
    <SectionCard title="Deploy" aside={<BehindChip summary={summary} pcDrift={data.deploy.pcDrift[config.name]} />}>
      {state.current ? (
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-nd-text-primary">
            <span className="shrink-0 rounded bg-nd-surface-raised px-1.5 py-px font-mono text-xs text-nd-text-secondary">{shortSha(state.current)}</span>
            <span className="truncate">{state.currentSubject}</span>
          </span>
          <span className="truncate text-xs text-nd-text-muted">{['live', liveCaption(summary)].filter(Boolean).join(' · ')}</span>
        </div>
      ) : <span className="text-[13px] text-nd-text-muted">Nothing live yet</span>}
      <span className="truncate text-xs text-nd-text-muted">{config.sourceMode === 'auto' ? 'Auto on server' : 'From my PC'} · {sourceMeta(config)}</span>
      <RunBars runs={recentRuns(summary)} caption={runsCaption(summary)} />
    </SectionCard>
  )
}

function CertRow({ label, value, tone }: { label: string; value: string; tone: KitTone }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[10px] border border-nd-border px-3 py-2">
      <StatusDot tone={tone} />
      <span className="w-20 shrink-0 text-xs text-nd-text-muted">{label}</span>
      <span className="truncate text-[13px] text-nd-text-primary">{value}</span>
    </div>
  )
}

function HttpsCard({ page }: { page: SitePageProps }) {
  const { ctx, data, entry } = page
  const host = worstHost(entry.hosts)
  const plain = plainBlock(entry)
  const site = entry.summary.config.name
  if (!host) {
    return (
      <SectionCard title="HTTPS">
        <span className="text-[13px] text-nd-text-muted">{plain ? 'This site is served over plain HTTP.' : data.ssl.report ? 'No web server site matched this folder.' : 'Checking certificates…'}</span>
        {plain && <Button size="sm" variant="primary" onClick={() => ctx.navigate(httpsRoute(plain.id, site))}>Add HTTPS</Button>}
      </SectionCard>
    )
  }
  const headline = verdictHeadline(host, data.now)
  const edge = edgeView(host.edge)
  const cert = certView(host, data.now)
  const certTone: KitTone = cert.tone
  return (
    <SectionCard title="HTTPS" aside={<Chip dense tone={headline.tone}>{headline.label}</Chip>}>
      <CertRow label="Cloudflare" value={[edge.label, edge.detail].filter(Boolean).join(' · ')} tone={edge.proxied ? 'success' : 'neutral'} />
      <CertRow label="Server" value={`${cert.kindLabel}${cert.daysText === '—' ? '' : ` · ${cert.daysText}`}`} tone={certTone} />
      <div>
        <Button size="sm" variant={hasHttpsRisk(entry) ? 'primary' : 'secondary'} onClick={() => page.openTab('domains')}>
          {hasHttpsRisk(entry) ? 'Fix HTTPS' : 'Domains & HTTPS'} <ArrowRight size={13} />
        </Button>
      </div>
    </SectionCard>
  )
}

function DomainsCard({ page }: { page: SitePageProps }) {
  const { entry } = page
  const names = siteNames(entry)
  return (
    <SectionCard title="Domains" count={names.length} aside={<Button size="sm" onClick={() => page.openTab('domains')}>Add domain</Button>}>
      {names.length === 0 && <span className="text-[13px] text-nd-text-muted">No web server site found for this folder.</span>}
      {names.map((name) => (
        <div key={name} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-nd-text-primary">{name}</span>
          <span className="text-xs text-nd-text-muted">{name === entry.domain ? 'primary' : 'alias'}</span>
        </div>
      ))}
    </SectionCard>
  )
}

function WorkersCard({ page }: { page: SitePageProps }) {
  const { ctx, data, entry } = page
  const { name, path } = entry.summary.config
  const jobs = useSiteJobs(data.connectionId, path)
  return (
    <SectionCard title="Workers & cron" count={jobs.length} aside={<Button size="sm" onClick={() => ctx.navigate(jobsRoute(name, path))}>Cron &amp; workers</Button>}>
      <JobRows jobs={jobs} />
    </SectionCard>
  )
}

function LogsCard({ page }: { page: SitePageProps }) {
  const { data, entry } = page
  const options = logSources(entry, data.inventory)
  const [selected, setSelected] = useState(options[0]?.id ?? '')
  const option = options.find((o) => o.id === selected) ?? options[0]
  const log = useSiteLog(data.connectionId, entry.summary.config.name, option, TAIL_LINES, false)
  const picker = options.length > 0 ? <Segmented ariaLabel="Log file" options={options.map((o) => ({ value: o.id, label: o.label }))} value={option?.id ?? ''} onChange={setSelected} /> : undefined
  return (
    <SectionCard title="Logs" aside={picker}>
      {options.length === 0
        ? <span className="text-[13px] text-nd-text-muted">No logs found for this site.</span>
        : <LogText log={log} className="max-h-52" />}
      <div><Button size="sm" variant="ghost" onClick={() => page.openTab('logs')}>Open logs <ArrowRight size={13} /></Button></div>
    </SectionCard>
  )
}

function DeploymentRow({ record, page }: { record: DeployRecord; page: SitePageProps }) {
  const { summary } = page.entry
  const status = runStatus(record, summary)
  return (
    <button
      type="button"
      onClick={() => { page.runs.select(record.id); page.openTab('deployments') }}
      className="grid grid-cols-[110px_70px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-nd-surface-hover"
    >
      <Chip dense tone={RUN_TONES[status.tone]}>{status.label}</Chip>
      <span className="font-mono text-xs text-nd-text-muted">{shortSha(record.commit)}</span>
      <span className="truncate text-[13px] text-nd-text-primary">{recordTitle(record)}</span>
      <span className="text-xs text-nd-text-muted">{timeAgo(record.finished ?? record.started, summary.state.now)}</span>
      <span className="text-xs text-nd-text-muted">{[triggerLabel(record.trigger), duration(record)].filter(Boolean).join(' · ')}</span>
    </button>
  )
}

function RecentDeployments({ page }: { page: SitePageProps }) {
  const records = page.entry.summary.history.slice(0, RECENT)
  return (
    <SectionCard title="Recent deployments" aside={<Button size="sm" variant="ghost" onClick={() => page.openTab('deployments')}>All deployments <ArrowRight size={13} /></Button>}>
      {records.length === 0
        ? <span className="text-[13px] text-nd-text-muted">No deployments yet.</span>
        : <div className="flex flex-col">{records.map((record) => <DeploymentRow key={record.id} record={record} page={page} />)}</div>}
    </SectionCard>
  )
}

export function OverviewTab({ page }: { page: SitePageProps }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
        <DeployCard page={page} />
        <HttpsCard page={page} />
        <DomainsCard page={page} />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <WorkersCard page={page} />
        <LogsCard page={page} />
      </div>
      <RecentDeployments page={page} />
    </div>
  )
}
