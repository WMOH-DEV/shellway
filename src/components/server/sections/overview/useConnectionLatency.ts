import { useEffect, useState } from 'react'

const POLL_MS = 10_000

export function useConnectionLatency(connectionId: string, enabled: boolean): number | null {
  const [latency, setLatency] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    const read = () => window.novadeck.health.getHealth(connectionId)
      .then((health) => { if (live) setLatency(health?.latencyMs ?? null) })
      .catch(() => { if (live) setLatency(null) })
    void read()
    const timer = setInterval(() => void read(), POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [connectionId, enabled])

  return latency
}
