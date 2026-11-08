import { useEffect, useState } from 'react'

export function useSslCritical(connectionId: string, connected: boolean): boolean {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!connected) {
      setCount(0)
      return
    }
    let active = true
    const ssl = window.novadeck.ssl
    void ssl.criticalCount(connectionId).then((result) => {
      if (active && result.success) setCount(result.data ?? 0)
    })
    const off = ssl.onCritical((id, value) => { if (id === connectionId) setCount(value) })
    return () => { active = false; off() }
  }, [connectionId, connected])

  return count > 0
}
