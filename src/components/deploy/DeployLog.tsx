import { useEffect, useRef, useState } from 'react'
import type { DeployRecord } from '@/types/deploy'
import { deployApi } from './useDeploySites'

const LOG_POLL_MS = 2_000

interface DeployLogProps {
  connectionId: string
  site: string
  record: DeployRecord
  live: boolean
}

export function DeployLog({ connectionId, site, record, live }: DeployLogProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const offsetRef = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    offsetRef.current = 0
    setText('')
    setError(null)
  }, [connectionId, site, record.id])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      const result = await deployApi().log(connectionId, site, record.id, offsetRef.current)
      if (cancelled) return
      if (result.success && result.data) {
        offsetRef.current = result.data.offset
        const chunk = result.data.text
        if (chunk) setText((current) => current + chunk)
        setError(null)
      } else {
        setError(result.error ?? 'Could not read the log')
      }
      if (live) timer = setTimeout(() => void read(), LOG_POLL_MS)
    }
    void read()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [connectionId, site, record.id, live])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [text])

  return (
    <div className="h-full overflow-auto rounded-md border border-nd-border bg-nd-bg-primary p-3 font-mono text-2xs leading-relaxed text-nd-text-primary">
      {error && <div className="text-nd-error">{error}</div>}
      <pre className="whitespace-pre-wrap break-words">{text || (live ? 'Starting…' : 'No log output')}</pre>
      <div ref={bottomRef} />
    </div>
  )
}
