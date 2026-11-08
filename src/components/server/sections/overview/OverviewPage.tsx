import { useEffect, useMemo } from 'react'
import { Plus, Power } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useDeploySites } from '@/components/deploy/useDeploySites'
import { useSslReport } from '@/components/ssl/useSslReport'
import { useSessionStore } from '@/stores/sessionStore'
import type { ServerIdentity } from '@/types/server/identity'
import { IDENTITY_PROBE } from '@/types/server/identity'
import { findProbe } from '@/utils/server/areas'
import { rootFilesystem, type Filesystem } from '@/utils/server/overview/disk'
import { okData } from '@/utils/server/overview/facts'
import { isFreshServer } from '@/utils/server/overview/fresh'
import { healthCells, sampleFromProbe, sampleFromSnapshot } from './model/health'
import { DISK_PROBE, LOAD_PROBE, METRICS_ROUTE, REBOOT_ACTION, SYSTEM_PROBE } from '@/utils/server/overview/ids'
import type { LoadSample } from '@/utils/server/overview/load'
import { serverInfoRows } from '@/utils/server/overview/serverInfo'
import { siteRows } from './model/sites'
import { softwareChips } from '@/utils/server/overview/software'
import { PACKAGES_PROBE, PHP_PROBE } from '@/utils/server/software/types'
import type { SystemState } from '@/utils/server/overview/system'
import { nowSeconds } from '@/utils/ssl/time'
import { useActionLauncher } from '../../action'
import { Notice, PageHeader, SectionPage } from '../../kit'
import { useServerFacts } from '../../useServerFacts'
import type { ServerSectionContext } from '../types'
import { AttentionList } from './AttentionList'
import { HealthStrip } from './HealthStrip'
import { ServerInfoCard } from './ServerInfoCard'
import { SetupCard } from './SetupCard'
import { SitesCard } from './SitesCard'
import { SoftwareCard } from './SoftwareCard'
import { useConnectionLatency } from './useConnectionLatency'
import { useLiveMonitor } from './useLiveMonitor'
import { useOverviewAttention } from './useOverviewAttention'

const PAGE_PROBES = [LOAD_PROBE, DISK_PROBE, SYSTEM_PROBE, IDENTITY_PROBE, PACKAGES_PROBE, PHP_PROBE]
  .filter((id) => findProbe(id) !== undefined)

function useRebootDeepLink(ctx: ServerSectionContext, reboot: () => void) {
  const requested = ctx.route.params?.action === 'reboot'
  useEffect(() => {
    if (!requested) return
    reboot()
    ctx.navigate({ section: 'overview' })
  }, [requested])
}

export function OverviewPage({ ctx }: { ctx: ServerSectionContext }) {
  const connected = ctx.connectionStatus === 'connected'
  const live = connected && ctx.active
  const launcher = useActionLauncher(ctx)
  const { facts } = useServerFacts(ctx, PAGE_PROBES)
  const attention = useOverviewAttention(ctx)
  const monitor = useLiveMonitor(ctx.connectionId, live)
  const deploy = useDeploySites(ctx.connectionId, ctx.sessionId, live)
  const ssl = useSslReport(ctx.connectionId, ctx.sessionId, live && deploy.sites.length > 0)
  const latency = useConnectionLatency(ctx.connectionId, live)
  const session = useSessionStore((state) => state.sessions.find((s) => s.id === ctx.sessionId) ?? null)

  const reboot = () => launcher.launch({ type: REBOOT_ACTION, params: {} })
  useRebootDeepLink(ctx, reboot)

  const filesystems = okData<Filesystem[]>(facts[DISK_PROBE])
  const system = okData<SystemState>(facts[SYSTEM_PROBE])
  const load = okData<LoadSample>(facts[LOAD_PROBE])

  const cells = useMemo(() => {
    if (monitor.snapshot) return healthCells(sampleFromSnapshot(monitor.snapshot, monitor.history))
    return load ? healthCells(sampleFromProbe(load, filesystems)) : null
  }, [monitor.snapshot, monitor.history, load, filesystems])

  const sites = useMemo(() => siteRows(deploy.sites, deploy.pcDrift, ssl.report, nowSeconds()), [deploy.sites, deploy.pcDrift, ssl.report])
  const chips = useMemo(() => softwareChips(facts), [facts])
  const siteCount = deploy.runner && !deploy.loading && !deploy.error ? deploy.sites.length : null
  const fresh = isFreshServer({ system, siteCount })

  const infoRows = serverInfoRows({
    identity: okData<ServerIdentity>(facts[IDENTITY_PROBE]),
    snapshot: monitor.snapshot,
    system,
    rootFs: filesystems ? rootFilesystem(filesystems) : null,
    session,
    connection: { status: ctx.connectionStatus, latencyMs: latency }
  })

  const showAttention = !fresh || attention.items.length > 0
  const showSide = !fresh || chips.length > 0

  return (
    <SectionPage>
      <PageHeader
        title="Overview"
        subtitle={`Everything about ${ctx.sessionName} at a glance.${monitor.snapshot ? ' Live, every 3 s.' : ''}`}
        actions={
          <>
            <Button variant="ghost" onClick={reboot} disabled={!connected}><Power size={14} aria-hidden />Reboot</Button>
            <Button onClick={() => ctx.navigate(METRICS_ROUTE)}>Full metrics</Button>
            <Button variant={fresh ? 'secondary' : 'primary'} onClick={() => ctx.navigate({ section: 'sites', sub: 'create' })}><Plus size={14} aria-hidden />Create site</Button>
          </>
        }
      />
      {!connected && <Notice tone="warning" title="Not connected">Live data comes back when Shellway reconnects to this server.</Notice>}
      {fresh && <SetupCard onStart={() => ctx.navigate({ section: 'setup' })} />}
      <HealthStrip cells={cells} />
      {(showAttention || showSide) && (
        <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-4">
          {showAttention ? <AttentionList items={attention.items} loading={attention.loading} onOpen={ctx.navigate} /> : <div />}
          <div className="flex min-w-0 flex-col gap-4">
            {!fresh && <SitesCard sites={sites} loading={deploy.loading} error={deploy.error} onOpen={ctx.navigate} />}
            {chips.length > 0 && <SoftwareCard chips={chips} onOpen={ctx.navigate} />}
          </div>
        </div>
      )}
      <ServerInfoCard rows={infoRows} />
    </SectionPage>
  )
}
