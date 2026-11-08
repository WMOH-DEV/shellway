import { useCallback, useEffect, useState } from 'react'
import type { CreateSiteContext } from '@/types/createSite'
import { createSiteApi } from './createSiteApi'

export interface CreateSiteContextState {
  context: CreateSiteContext | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

export function useCreateSiteContext(connectionId: string, sessionId: string): CreateSiteContextState {
  const [context, setContext] = useState<CreateSiteContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await createSiteApi().context(connectionId, sessionId)
    setLoading(false)
    if (result.success && result.data) setContext(result.data)
    else setError(result.error ?? 'Could not check the server')
  }, [connectionId, sessionId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { context, loading, error, reload }
}
