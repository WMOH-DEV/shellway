import { useEffect, useState } from 'react'
import type { SiteRef } from '@/utils/server/docker/stacks'

export function useLinkedSites(connectionId: string, sessionId: string, enabled: boolean): SiteRef[] {
  const [sites, setSites] = useState<SiteRef[]>([])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void window.novadeck.deploy.list(connectionId, sessionId).then((result) => {
      if (cancelled || !result.success || !result.data) return
      setSites(result.data.map((site) => ({ name: site.config.name, path: site.config.path })))
    })
    return () => {
      cancelled = true
    }
  }, [connectionId, sessionId, enabled])

  return sites
}
