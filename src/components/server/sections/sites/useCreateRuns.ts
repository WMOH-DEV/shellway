import { useCallback, useEffect, useState } from 'react'
import { createSiteApi } from '@/components/deploy/createSite/createSiteApi'
import type { RunRecord } from '@/types/createSite'
import { latestUnfinished } from '@/utils/createSite/runView'

export interface CreateRuns {
  runs: RunRecord[]
  loaded: boolean
  unfinished: RunRecord | null
  refresh: () => Promise<void>
}

export function useCreateRuns(sessionId: string, connected: boolean): CreateRuns {
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const result = await createSiteApi().runs(sessionId)
    setRuns(result.success && result.data ? result.data : [])
    setLoaded(true)
  }, [sessionId])

  useEffect(() => {
    if (connected) void refresh()
  }, [connected, refresh])

  return { runs, loaded, unfinished: latestUnfinished(runs), refresh }
}

export const runForSite = (runs: RunRecord[], site: string): RunRecord | undefined =>
  runs.find((run) => run.created.deploySite === site && run.phase !== 'removed')
