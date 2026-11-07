import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServerFacts } from '@/types/server/core'
import type { ServerSectionContext } from './sections/types'
import { serverApi } from './serverApi'

export interface FactsState {
  facts: ServerFacts
  loading: boolean
  error: string | null
  refresh(): Promise<void>
}

export function useServerFacts(ctx: Pick<ServerSectionContext, 'connectionId' | 'active'>, probeIds: readonly string[]): FactsState {
  const [facts, setFacts] = useState<ServerFacts>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = useRef(probeIds)
  ids.current = probeIds
  const key = probeIds.join(',')

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    const result = await serverApi().scan(ctx.connectionId, [...ids.current], force)
    setLoading(false)
    if (!result.success) return setError(result.error)
    setError(null)
    setFacts((previous) => ({ ...previous, ...result.data }))
  }, [ctx.connectionId])

  useEffect(() => {
    if (ctx.active) void load(false)
  }, [ctx.active, key, load])

  useEffect(() => serverApi().onFacts((connectionId, next) => {
    if (connectionId !== ctx.connectionId) return
    const wanted = Object.fromEntries(Object.entries(next).filter(([id]) => ids.current.includes(id)))
    setFacts((previous) => ({ ...previous, ...wanted }))
  }), [ctx.connectionId])

  const refresh = useCallback(() => load(true), [load])
  return { facts, loading, error, refresh }
}
