import { useEffect, useRef, useState } from 'react'
import { deployApi } from '../useDeploySites'

const LOG_POLL_MS = 2_000
const MAX_FAILED_READS = 5

export function useRunLog(connectionId: string, site: string, recordId: string, live: boolean): { text: string; error: string | null } {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const offsetRef = useRef(0)

  useEffect(() => {
    offsetRef.current = 0
    setText('')
    setError(null)
  }, [connectionId, site, recordId])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failedReads = 0
    const read = async () => {
      const result = await deployApi().log(connectionId, site, recordId, offsetRef.current)
      if (cancelled) return
      if (result.success && result.data) {
        offsetRef.current = result.data.offset
        const chunk = result.data.text
        if (chunk) setText((current) => current + chunk)
        setError(null)
        failedReads = 0
      } else {
        setError(result.error ?? 'Could not read the log')
        failedReads += 1
      }
      if (live && failedReads < MAX_FAILED_READS) timer = setTimeout(() => void read(), LOG_POLL_MS)
    }
    void read()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [connectionId, site, recordId, live])

  return { text, error }
}
