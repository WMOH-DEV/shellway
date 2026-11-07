import { useEffect, useState } from 'react'
import type { ServerFacts } from '@/types/server/core'
import { siteJobs, type SiteJob } from '@/utils/server/sites/jobs'
import { serverApi } from '../../../serverApi'

export function useSiteJobs(connectionId: string, sitePath: string): SiteJob[] {
  const [facts, setFacts] = useState<ServerFacts>({})

  useEffect(() => {
    let alive = true
    void serverApi().facts(connectionId).then((result) => {
      if (alive && result.success) setFacts(result.data)
    })
    const off = serverApi().onFacts((id, next) => {
      if (id === connectionId) setFacts((previous) => ({ ...previous, ...next }))
    })
    return () => {
      alive = false
      off()
    }
  }, [connectionId])

  return siteJobs(facts, sitePath)
}
