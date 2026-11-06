import { useEffect, useState } from 'react'
import { nowSeconds } from '@/utils/ssl/time'

const TICK_MS = 60_000

export function useNowSeconds(): number {
  const [now, setNow] = useState(nowSeconds)

  useEffect(() => {
    const timer = setInterval(() => setNow(nowSeconds()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return now
}
