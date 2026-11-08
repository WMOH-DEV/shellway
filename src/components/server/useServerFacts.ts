import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ServerFacts } from '@/types/server/core'
import { listenForFacts, pickFacts, scanFacts, useServerFactsStore } from '@/stores/serverFactsStore'
import type { ServerSectionContext } from './sections/types'

export interface FactsState {
  facts: ServerFacts
  loading: boolean
  error: string | null
  refresh(): Promise<void>
}

export function useServerFacts(ctx: Pick<ServerSectionContext, 'connectionId' | 'active'>, probeIds: readonly string[]): FactsState {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = useRef(probeIds)
  ids.current = probeIds
  const key = probeIds.join(',')
  const connectionFacts = useServerFactsStore((state) => state.byConnection[ctx.connectionId])
  const facts = useMemo(() => pickFacts(connectionFacts, ids.current), [connectionFacts, key])

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    const result = await scanFacts(ctx.connectionId, ids.current, force)
    setLoading(false)
    setError(result.success ? null : result.error)
  }, [ctx.connectionId])

  useEffect(listenForFacts, [])

  useEffect(() => {
    if (ctx.active) void load(false)
  }, [ctx.active, key, load])

  const refresh = useCallback(() => load(true), [load])
  return { facts, loading, error, refresh }
}
