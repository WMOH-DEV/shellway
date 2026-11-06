import { useCallback, useEffect, useState } from 'react'
import type { SslResult } from '@/types/ssl'

export interface SslResource<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => Promise<void>
  replace: (data: T) => void
}

export function useSslResource<T>(load: () => Promise<SslResult<T>>): SslResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await load()
    if (result.success && result.data) setData(result.data)
    else setError(result.error ?? 'Could not load this')
    setLoading(false)
  }, [load])

  useEffect(() => { void reload() }, [reload])

  const replace = useCallback((next: T) => {
    setData(next)
    setError(null)
  }, [])

  return { data, error, loading, reload, replace }
}
