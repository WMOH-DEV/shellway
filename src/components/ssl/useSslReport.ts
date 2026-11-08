import { useCallback, useEffect, useRef, useState } from 'react'
import type { SslReport } from '@/types/ssl'
import { sslApi } from './sslApi'

export interface SslReportState {
  report: SslReport | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useSslReport(connectionId: string, sessionId: string, connected: boolean): SslReportState {
  const [report, setReport] = useState<SslReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef<Promise<void> | null>(null)
  const queued = useRef<Promise<void> | null>(null)

  const loadOnce = useCallback(async () => {
    setLoading(true)
    try {
      const result = await sslApi().check(connectionId, sessionId)
      if (!mounted.current) return
      if (result.success && result.data) {
        setReport(result.data)
        setError(null)
      } else {
        setError(result.error ?? 'Could not check certificates')
      }
    } catch (err) {
      if (mounted.current) setError((err as Error).message)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [connectionId, sessionId])

  const start = useCallback((): Promise<void> => {
    const running = loadOnce().finally(() => { inFlight.current = null })
    inFlight.current = running
    return running
  }, [loadOnce])

  const refresh = useCallback((): Promise<void> => {
    if (!inFlight.current) return start()
    queued.current ??= inFlight.current.then(() => {
      queued.current = null
      return start()
    })
    return queued.current
  }, [start])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (connected && !inFlight.current) void start()
  }, [connected, start])

  return { report, loading, error, refresh }
}
