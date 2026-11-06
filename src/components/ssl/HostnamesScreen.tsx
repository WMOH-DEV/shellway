import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { SslReport } from '@/types/ssl'
import { criticalBanner } from '@/utils/ssl/banner'
import { hostnamesSubtitle, nginxNotice } from '@/utils/ssl/header'
import { filterCounts, matchesFilter, type HostFilter } from '@/utils/ssl/hostRow'
import { CriticalBanner } from './CriticalBanner'
import { HostFilterBar } from './HostFilterBar'
import { HostList } from './HostList'
import { HostnamesHeader } from './HostnamesHeader'
import { ErrorBanner } from './LoadState'
import { EmptyHostnames, PartialNotice } from './NginxNotice'
import { ServerStrip } from './ServerStrip'

interface HostnamesScreenProps {
  report: SslReport
  serverName: string
  now: number
  loading: boolean
  error: string | null
  onRefresh: () => void
  onOpen: (name: string) => void
  onOpenSettings: () => void
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center text-[13px] text-nd-text-muted">
      No hostnames match
      <Button size="sm" variant="ghost" onClick={onClear}>Clear filter</Button>
    </div>
  )
}

export function HostnamesScreen({ report, serverName, now, loading, error, onRefresh, onOpen, onOpenSettings }: HostnamesScreenProps) {
  const { hostnames, facts, cloudflare } = report
  const [filter, setFilter] = useState<HostFilter>('all')
  const counts = useMemo(() => filterCounts(hostnames), [hostnames])
  const shown = useMemo(() => hostnames.filter((h) => matchesFilter(h, filter)), [hostnames, filter])
  const banner = useMemo(() => criticalBanner(hostnames, now), [hostnames, now])
  const notice = nginxNotice(facts)

  return (
    <div className="h-full overflow-y-auto bg-nd-bg-primary">
      <div className="mx-auto flex min-h-full w-full max-w-[1400px] flex-col gap-4 px-7 pb-7 pt-5">
        <HostnamesHeader
          subtitle={hostnamesSubtitle(report, serverName, now)}
          cloudflare={cloudflare}
          loading={loading}
          onRefresh={onRefresh}
          onOpenSettings={onOpenSettings}
        />
        {error && <ErrorBanner message={error} retrying={loading} onRetry={onRefresh} />}
        {banner && <CriticalBanner banner={banner} onFix={onOpen} />}
        <ServerStrip facts={facts} now={now} onOpenSettings={onOpenSettings} />
        {hostnames.length === 0 ? <EmptyHostnames notice={notice} /> : (
          <>
            {notice && <PartialNotice notice={notice} />}
            <HostFilterBar value={filter} counts={counts} onChange={setFilter} />
            {shown.length > 0
              ? <HostList hosts={shown} facts={facts} now={now} onOpen={onOpen} />
              : <NoMatches onClear={() => setFilter('all')} />}
          </>
        )}
      </div>
    </div>
  )
}
