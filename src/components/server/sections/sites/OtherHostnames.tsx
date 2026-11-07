import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { CriticalBanner } from '@/components/ssl/CriticalBanner'
import { HostFilterBar } from '@/components/ssl/HostFilterBar'
import { HostList } from '@/components/ssl/HostList'
import { ErrorBanner } from '@/components/ssl/LoadState'
import { PartialNotice } from '@/components/ssl/NginxNotice'
import { ServerStrip } from '@/components/ssl/ServerStrip'
import { TONE_FILL } from '@/components/ssl/tones'
import { criticalBanner } from '@/utils/ssl/banner'
import { cloudflareButton, webServerNotice } from '@/utils/ssl/header'
import { filterCounts, matchesFilter, type HostFilter } from '@/utils/ssl/hostRow'
import { SectionCard } from '../../kit'
import type { ServerSectionContext } from '../types'
import { hostnameRoute, httpsRoute, siteRoute, sslSettingsRoute } from './routes'
import type { SitesData } from './useSitesData'

export function OtherHostnames({ ctx, data }: { ctx: ServerSectionContext; data: SitesData }) {
  const { report, loading, error, refresh } = data.ssl
  const { otherHosts, sites } = data.join
  const [filter, setFilter] = useState<HostFilter>('all')
  const counts = useMemo(() => filterCounts(otherHosts), [otherHosts])
  const banner = useMemo(() => (report ? criticalBanner(report.hostnames, data.now) : null), [report, data.now])

  const openHost = (name: string) => {
    const owner = sites.find((entry) => entry.hosts.some((h) => h.name === name))
    ctx.navigate(owner ? siteRoute(owner.summary.config.name, 'domains') : hostnameRoute(name))
  }

  if (!report) {
    if (error) return <ErrorBanner message={error} retrying={loading} onRetry={() => void refresh()} />
    return <div className="flex items-center gap-2 py-4 text-[13px] text-nd-text-muted"><Spinner size="sm" /> Checking certificates…</div>
  }

  const notice = webServerNotice(report.facts)
  const cloudflare = cloudflareButton(report.cloudflare)
  const shown = otherHosts.filter((h) => matchesFilter(h, filter))
  const aside = (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={() => ctx.navigate(sslSettingsRoute())}>
        <span className={`h-[7px] w-[7px] rounded-full ${TONE_FILL[cloudflare.tone]}`} />
        {cloudflare.label}
      </Button>
      <Button size="sm" onClick={() => ctx.navigate(httpsRoute())}><Plus size={13} /> Add HTTPS</Button>
    </div>
  )

  return (
    <>
      {error && <ErrorBanner message={error} retrying={loading} onRetry={() => void refresh()} />}
      {banner && <CriticalBanner banner={banner} onFix={openHost} />}
      <SectionCard title="Other hostnames" count={otherHosts.length} aside={aside}>
        <p className="text-[13px] text-nd-text-muted">Found by the HTTPS check on this server but not part of a site Shellway deploys.</p>
        <ServerStrip facts={report.facts} now={data.now} onOpenSettings={() => ctx.navigate(sslSettingsRoute())} />
        {notice && <PartialNotice notice={notice} />}
        {otherHosts.length > 0 && <HostFilterBar value={filter} counts={counts} onChange={setFilter} />}
        {shown.length > 0
          ? <HostList hosts={shown} facts={report.facts} now={data.now} onOpen={openHost} onAddHttps={(blockId) => ctx.navigate(httpsRoute(blockId))} />
          : <p className="py-2 text-[13px] text-nd-text-muted">{otherHosts.length === 0 ? 'Every hostname on this server belongs to a site above.' : 'No hostnames match this filter.'}</p>}
      </SectionCard>
    </>
  )
}
