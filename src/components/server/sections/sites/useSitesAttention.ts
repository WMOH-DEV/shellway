import { useEffect, useMemo, useState } from 'react'
import { useDeploySites } from '@/components/deploy/useDeploySites'
import { sslApi } from '@/components/ssl/sslApi'
import { useNowSeconds } from '@/components/ssl/useNowSeconds'
import type { AttentionItem } from '@/types/server/core'
import type { SslReport } from '@/types/ssl'
import { joinSites } from '@/utils/server/sites/join'
import type { ServerSectionContext } from '../types'
import { sitesAttention } from './model/attention'

type AttentionContext = Pick<ServerSectionContext, 'connectionId' | 'sessionId' | 'connectionStatus'>

function useLastSslReport(connectionId: string, connected: boolean): SslReport | null {
  const [report, setReport] = useState<SslReport | null>(null)
  useEffect(() => {
    if (!connected) return
    let alive = true
    void sslApi().lastReport(connectionId).then((result) => {
      if (alive && result.success) setReport(result.data ?? null)
    })
    return () => { alive = false }
  }, [connectionId, connected])
  return report
}

export function useSitesAttention(ctx: AttentionContext): AttentionItem[] {
  const connected = ctx.connectionStatus === 'connected'
  const { sites } = useDeploySites(ctx.connectionId, ctx.sessionId, connected)
  const report = useLastSslReport(ctx.connectionId, connected)
  const now = useNowSeconds()
  return useMemo(() => sitesAttention(joinSites(sites, report), now), [sites, report, now])
}
