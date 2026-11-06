import { useCallback, useEffect, useRef, useState } from 'react'
import type { SslResult } from '@/types/ssl'
import { sslApi } from '../sslApi'

export interface RunOutcome<T> {
  data: T | null
  error: string | null
}

export interface StreamedRun {
  running: boolean
  output: string
  start: <T>(task: (runId: string) => Promise<SslResult<T>>) => Promise<RunOutcome<T>>
}

export function useStreamedRun(): StreamedRun {
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const mounted = useRef(true)
  const busy = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const start = useCallback(async <T,>(task: (runId: string) => Promise<SslResult<T>>): Promise<RunOutcome<T>> => {
    if (busy.current) return { data: null, error: 'Another run is still going' }
    busy.current = true
    const runId = crypto.randomUUID()
    setRunning(true)
    setOutput('')
    const stopListening = sslApi().onOutput((id, chunk) => {
      if (id === runId && mounted.current) setOutput((current) => current + chunk)
    })
    try {
      const result = await task(runId)
      return result.success && result.data !== undefined
        ? { data: result.data, error: null }
        : { data: null, error: result.error ?? 'The run could not start' }
    } catch (err) {
      return { data: null, error: (err as Error).message }
    } finally {
      stopListening()
      busy.current = false
      if (mounted.current) setRunning(false)
    }
  }, [])

  return { running, output, start }
}
