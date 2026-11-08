import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityEntry } from '@/types/server/core'
import { ACTIVITY_PAGE_SIZE, mergeEntries, oldestAt, toActivityQuery, type ActivityFilter } from '@/utils/server/activity/filter'
import { serverApi } from '../../serverApi'
import type { ServerSectionContext } from '../types'

export interface ActivityState {
  entries: ActivityEntry[]
  loading: boolean
  error: string | null
  hasMore: boolean
  loadOlder(): void
  refresh(): void
}

export function useActivity(ctx: ServerSectionContext, filter: ActivityFilter): ActivityState {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const generation = useRef(0)
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  const fetchPage = useCallback(async (before: number | undefined, mode: 'replace' | 'merge') => {
    const ticket = mode === 'replace' ? ++generation.current : generation.current
    setLoading(true)
    const result = await serverApi().activity(ctx.sessionId, toActivityQuery(filter, before))
      .catch((err: Error) => ({ success: false as const, error: err.message }))
    if (ticket !== generation.current) return
    setLoading(false)
    if (!result.success) return setError(result.error)
    setError(null)
    setEntries((current) => mode === 'replace' ? mergeEntries([], result.data) : mergeEntries(current, result.data))
    if (mode === 'replace' || before !== undefined) setHasMore(result.data.length >= ACTIVITY_PAGE_SIZE)
  }, [ctx.sessionId, filter])

  useEffect(() => {
    if (ctx.active) void fetchPage(undefined, 'replace')
  }, [ctx.active, fetchPage])

  useEffect(() => serverApi().onRun((run) => {
    if (run.sessionKey === ctx.sessionId && run.status !== 'running') void fetchPage(undefined, 'merge')
  }), [ctx.sessionId, fetchPage])

  const loadOlder = useCallback(() => void fetchPage(oldestAt(entriesRef.current), 'merge'), [fetchPage])
  const refresh = useCallback(() => void fetchPage(undefined, 'merge'), [fetchPage])

  return { entries, loading, error, hasMore, loadOlder, refresh }
}
