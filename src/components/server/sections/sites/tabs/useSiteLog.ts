import { useCallback, useEffect, useRef, useState } from 'react'
import type { SiteLogResult } from '@/utils/server/sites/types'
import type { LogSourceOption } from '@/utils/server/sites/logSources'
import { serverApi } from '../../../serverApi'

const FOLLOW_MS = 4_000

export interface SiteLogState {
  result: SiteLogResult | null
  error: string | null
  loading: boolean
  reload: () => void
}

export function useSiteLog(connectionId: string, site: string, option: LogSourceOption | undefined, lines: number, follow: boolean): SiteLogState {
  const [result, setResult] = useState<SiteLogResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const latest = useRef(0)
  const pending = useRef(false)
  const source = option?.source
  const file = option?.file

  const load = useCallback(async () => {
    if (!source || !file) return
    const request = ++latest.current
    pending.current = true
    setLoading(true)
    const response = await serverApi().sites.tail(connectionId, { site, source, file, lines })
    if (request !== latest.current) return
    pending.current = false
    setLoading(false)
    if (response.success) {
      setResult(response.data)
      setError(null)
    } else setError(response.error)
  }, [connectionId, site, source, file, lines])

  useEffect(() => {
    setResult(null)
    void load()
  }, [load])

  useEffect(() => {
    if (!follow) return
    const timer = setInterval(() => { if (!pending.current) void load() }, FOLLOW_MS)
    return () => clearInterval(timer)
  }, [follow, load])

  return { result, error, loading, reload: () => void load() }
}
