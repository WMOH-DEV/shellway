import { useCallback, useEffect, useState } from 'react'
import type { RunRecord } from '@/types/createSite'
import { latestUnfinished } from '@/utils/createSite/runView'
import { createSiteApi } from './createSiteApi'

export interface UnfinishedRun {
  run: RunRecord | null
  refresh: () => Promise<void>
}

export function useUnfinishedRun(sessionId: string, connected: boolean): UnfinishedRun {
  const [run, setRun] = useState<RunRecord | null>(null)

  const refresh = useCallback(async () => {
    const result = await createSiteApi().runs(sessionId)
    setRun(result.success && result.data ? latestUnfinished(result.data) : null)
  }, [sessionId])

  useEffect(() => {
    if (connected) void refresh()
  }, [connected, refresh])

  return { run, refresh }
}
