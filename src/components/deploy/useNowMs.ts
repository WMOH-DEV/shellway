import { useEffect, useState } from 'react'

const TICK_MS = 1_000

export function useNowMs(ticking: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    setNowMs(Date.now())
    if (!ticking) return
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [ticking])

  return nowMs
}
