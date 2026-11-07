import { SslSettings } from '@/components/ssl/settings/SslSettings'
import { useSslReport } from '@/components/ssl/useSslReport'
import { ZoneModeScreen } from '@/components/ssl/zoneMode/ZoneModeScreen'
import type { ServerSectionContext } from '../types'

export const CLOUDFLARE_SUB = 'cloudflare'
export const CLOUDFLARE_ZONE_SUB = 'cloudflare-zone'

export function CloudflareSettings({ ctx }: { ctx: ServerSectionContext }) {
  const connected = ctx.connectionStatus === 'connected'
  const { report, loading, refresh } = useSslReport(ctx.connectionId, ctx.sessionId, connected)
  const recheck = () => { if (connected) void refresh() }
  const openCloudflare = () => ctx.navigate({ section: 'settings', sub: CLOUDFLARE_SUB })
  const zone = ctx.route.sub === CLOUDFLARE_ZONE_SUB ? ctx.route.params?.zone : undefined

  if (zone) {
    return <ZoneModeScreen key={zone} zone={zone} onCancel={openCloudflare} onFinished={() => { recheck(); openCloudflare() }} />
  }
  return (
    <SslSettings
      connectionId={ctx.connectionId}
      report={report}
      checking={loading}
      onBack={() => ctx.navigate({ section: 'settings' })}
      onRecheck={recheck}
      onCloudflareChanged={recheck}
      onSetZoneStrict={(name) => ctx.navigate({ section: 'settings', sub: CLOUDFLARE_ZONE_SUB, params: { zone: name } })}
    />
  )
}
