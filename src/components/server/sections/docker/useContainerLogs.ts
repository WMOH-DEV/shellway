import { useEffect, useState } from 'react'
import { serverApi } from '../../serverApi'

const KEEP_CHARS = 400_000

export interface ContainerLogs {
  text: string
  running: boolean
  notice: string | null
}

const streamKey = (tabId: string): string => `docker-${tabId.replace(/[^\w:.-]/g, '')}`.slice(0, 128)

const keepTail = (text: string): string => (text.length > KEEP_CHARS ? text.slice(text.length - KEEP_CHARS) : text)

export function useContainerLogs(connectionId: string, tabId: string, container: string, follow: boolean, nonce: number): ContainerLogs {
  const [logs, setLogs] = useState<ContainerLogs>({ text: '', running: true, notice: null })

  useEffect(() => {
    const api = serverApi().docker
    const key = streamKey(tabId)
    let streamId: string | null = null
    let cancelled = false
    const early: [string, string][] = []
    const endedEarly = new Map<string, string | null>()
    const append = (chunk: string) => setLogs((previous) => ({ ...previous, text: keepTail(previous.text + chunk) }))
    setLogs({ text: '', running: true, notice: null })

    const offData = api.onLogData((id, chunk) => {
      if (streamId === null) early.push([id, chunk])
      else if (id === streamId) append(chunk)
    })
    const finish = (message: string | null) => setLogs((previous) => ({ ...previous, running: false, notice: message }))
    const offEnd = api.onLogEnd((id, message) => {
      if (streamId === null) endedEarly.set(id, message)
      else if (id === streamId) finish(message)
    })

    void api.startLogs(connectionId, key, container, follow).then((result) => {
      if (cancelled) return
      if (!result.success) return setLogs({ text: '', running: false, notice: result.error })
      streamId = result.data
      early.filter(([id]) => id === streamId).forEach(([, chunk]) => append(chunk))
      if (endedEarly.has(result.data)) finish(endedEarly.get(result.data) ?? null)
    })

    return () => {
      cancelled = true
      offData()
      offEnd()
      void api.stopLogs(key)
    }
  }, [connectionId, tabId, container, follow, nonce])

  return logs
}
