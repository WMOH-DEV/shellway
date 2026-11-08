import { HostnameDetail } from '@/components/ssl/HostnameDetail'
import { AddHttpsWizard } from '@/components/ssl/https/AddHttpsWizard'
import { useCertbotRun } from '@/components/ssl/detail/useCertbotRun'
import { ErrorState, LoadingState } from '@/components/ssl/LoadState'
import { SwitchWizard } from '@/components/ssl/originCa/SwitchWizard'
import { SslSettings } from '@/components/ssl/settings/SslSettings'
import { ZoneModeScreen } from '@/components/ssl/zoneMode/ZoneModeScreen'
import { isFinishedSite } from '@/utils/createSite/runView'
import { SectionCard } from '../../kit'
import type { ServerSectionContext } from '../types'
import { DeleteSiteRow } from './DeleteSiteRow'
import { hostnameRoute, originRoute, returnRoute, sitesRoute, siteRoute, sslSettingsRoute, zoneRoute } from './routes'
import { runForHost, type CreateRuns } from './useCreateRuns'
import type { SitesData } from './useSitesData'

export const SSL_PAGES: ReadonlySet<string> = new Set(['https', 'hostname', 'origin', 'zone', 'ssl-settings'])

export function SslPages({ ctx, data, createRuns }: { ctx: ServerSectionContext; data: SitesData; createRuns: CreateRuns }) {
  const { report, loading, error, refresh } = data.ssl
  const run = useCertbotRun(data.connectionId, () => void refresh())
  const params = ctx.route.params ?? {}
  const site = params.site
  const back = () => ctx.navigate(returnRoute(site))
  const finished = () => { void refresh(); back() }
  const zone = (name: string) => ctx.navigate(zoneRoute(name, site, ctx.route.sub))

  if (ctx.route.sub === 'zone' && params.zone) {
    const cancel = () => (params.from === 'ssl-settings' ? ctx.navigate(sslSettingsRoute(site)) : back())
    return <ZoneModeScreen key={params.zone} zone={params.zone} onCancel={cancel} onFinished={finished} />
  }

  if (ctx.route.sub === 'ssl-settings') {
    return (
      <SslSettings
        connectionId={data.connectionId}
        report={report}
        checking={loading}
        onBack={back}
        onRecheck={() => void refresh()}
        onCloudflareChanged={() => void refresh()}
        onSetZoneStrict={zone}
      />
    )
  }

  if (!report) return error ? <ErrorState message={error} retrying={loading} onRetry={() => void refresh()} /> : <LoadingState />

  if (ctx.route.sub === 'https') {
    return (
      <AddHttpsWizard
        key={params.blockId ?? 'new'}
        connectionId={data.connectionId}
        sessionId={data.sessionId}
        serverName={data.serverName}
        report={report}
        blockId={params.blockId ?? null}
        onCancel={back}
        onFinished={finished}
        onBackToDeploy={() => { void refresh(); ctx.navigate(site ? siteRoute(site) : sitesRoute()) }}
        onSetZoneStrict={zone}
      />
    )
  }

  const host = report.hostnames.find((h) => h.name === params.name)
  if (!host) return <ErrorState message="This hostname is no longer on the server." retrying={loading} onRetry={() => ctx.navigate(sitesRoute())} />

  if (ctx.route.sub === 'origin') {
    return (
      <SwitchWizard
        key={host.name}
        connectionId={data.connectionId}
        sessionId={data.sessionId}
        report={report}
        host={host}
        onCancel={() => ctx.navigate(site ? siteRoute(site, 'domains') : hostnameRoute(host.name))}
        onFinished={finished}
      />
    )
  }

  const made = runForHost(createRuns.runs, host.name)
  const deleteCard = made && isFinishedSite(made) ? <SectionCard title="Delete site"><DeleteSiteRow ctx={ctx} run={made} /></SectionCard> : undefined

  return (
    <HostnameDetail
      key={host.name}
      footer={deleteCard}
      connectionId={data.connectionId}
      sessionId={data.sessionId}
      host={host}
      report={report}
      now={data.now}
      loading={loading}
      error={error}
      run={run}
      onBack={() => ctx.navigate(sitesRoute())}
      onAddHttps={(blockId) => ctx.navigate({ section: 'sites', sub: 'https', params: { blockId } })}
      onSwitchOrigin={(name) => ctx.navigate(originRoute(name))}
      onSetZoneStrict={zone}
      onRefresh={refresh}
    />
  )
}
