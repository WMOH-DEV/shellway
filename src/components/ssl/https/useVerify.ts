import { useCallback, useEffect, useRef, useState } from 'react'
import type { VerifyResult } from '@/types/ssl'
import { sslApi } from '../sslApi'
import type { Issued } from './useIssue'

export interface Verify {
  result: VerifyResult | null
  error: string | null
  loading: boolean
  run: () => Promise<void>
}

export function useVerify(connectionId: string, issued: Issued | null): Verify {
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const run = useCallback(async () => {
    if (!issued) return
    setLoading(true)
    setError(null)
    try {
      const response = await sslApi().httpsVerify(connectionId, issued.names, issued.lineage)
      if (!mounted.current) return
      if (response.success && response.data) setResult(response.data)
      else setError(response.error ?? 'Could not verify the certificate')
    } catch (err) {
      if (mounted.current) setError((err as Error).message)
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [connectionId, issued])

  useEffect(() => { void run() }, [run])

  return { result, error, loading, run }
}
