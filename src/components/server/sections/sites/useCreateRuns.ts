import { useCallback, useEffect, useRef, useState } from 'react'
import { createSiteApi } from '@/components/deploy/createSite/createSiteApi'
import type { RunPhase, RunRecord } from '@/types/createSite'
import { latestUnfinished } from '@/utils/createSite/runView'
import { siteNames } from '@/utils/createSite/templates/shared'

export interface CreateRuns {
  runs: RunRecord[]
  loaded: boolean
  unfinished: RunRecord | null
  refresh: () => Promise<void>
}

const GOING: ReadonlySet<RunPhase> = new Set(['running', 'removing'])

function withRun(runs: RunRecord[], record: RunRecord): RunRecord[] {
  const others = runs.filter((run) => run.id !== record.id)
  if (record.phase === 'removed') return others
  return [record, ...others].sort((a, b) => b.createdAt - a.createdAt)
}

export function useCreateRuns(sessionId: string, connected: boolean, onSettled: () => void): CreateRuns {
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const phases = useRef(new Map<string, RunPhase>())
  const settled = useRef(onSettled)
  settled.current = onSettled

  const refresh = useCallback(async () => {
    const result = await createSiteApi().runs(sessionId)
    const next = result.success && result.data ? result.data : []
    phases.current = new Map(next.map((run) => [run.id, run.phase]))
    setRuns(next)
    setLoaded(true)
  }, [sessionId])

  useEffect(() => {
    if (connected) void refresh()
  }, [connected, refresh])

  useEffect(() => {
    const off = createSiteApi().onUpdate((record) => {
      if (record.sessionId !== sessionId) return
      const before = phases.current.get(record.id)
      phases.current.set(record.id, record.phase)
      setRuns((current) => withRun(current, record))
      if (before !== record.phase && !GOING.has(record.phase)) settled.current()
    })
    return () => {
      off()
    }
  }, [sessionId])

  return { runs, loaded, unfinished: latestUnfinished(runs), refresh }
}

export const runForSite = (runs: RunRecord[], site: string): RunRecord | undefined =>
  runs.find((run) => run.created.deploySite === site && run.phase !== 'removed')

export const runForHost = (runs: RunRecord[], host: string): RunRecord | undefined =>
  runs.find((run) => run.phase !== 'removed' && siteNames(run.input).some((name) => name.toLowerCase() === host.toLowerCase()))
