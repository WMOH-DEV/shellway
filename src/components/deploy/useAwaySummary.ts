import { useEffect, useRef, useState } from 'react'
import type { SiteSummary } from '@/types/deploy'
import { awaySummary, type AwaySummary } from '@/utils/deploy/siteRow'

const storageKey = (sessionId: string) => `shellway.deploy.lastVisit.${sessionId}`

function readLastVisit(sessionId: string): number | null {
  try {
    const value = Number.parseInt(localStorage.getItem(storageKey(sessionId)) ?? '', 10)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function writeLastVisit(sessionId: string, serverNow: number): void {
  try {
    localStorage.setItem(storageKey(sessionId), String(serverNow))
  } catch {
    return
  }
}

const newestServerTime = (sites: SiteSummary[]) => Math.max(...sites.map((s) => s.state.now))

export function useAwaySummary(sessionId: string, sites: SiteSummary[], watching: boolean): { summary: AwaySummary | null; dismiss: () => void } {
  const [summary, setSummary] = useState<AwaySummary | null>(null)
  const visitOpen = useRef(false)

  useEffect(() => {
    if (!watching) {
      visitOpen.current = false
      return
    }
    if (sites.length === 0) return
    if (!visitOpen.current) {
      visitOpen.current = true
      setSummary(awaySummary(sites, readLastVisit(sessionId)))
    }
    writeLastVisit(sessionId, newestServerTime(sites))
  }, [sessionId, sites, watching])

  return { summary, dismiss: () => setSummary(null) }
}
