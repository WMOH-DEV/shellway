import { useEffect, useState } from 'react'
import { useMonitorStore } from '@/stores/monitorStore'
import type { MonitorSnapshot, MonitorStatus } from '@/types/monitor'

export interface LiveMonitor {
  snapshot: MonitorSnapshot | null
  history: MonitorSnapshot[]
  available: boolean
}

const UNAVAILABLE: ReadonlySet<MonitorStatus> = new Set(['unsupported', 'error'])
const EMPTY: MonitorSnapshot[] = []

const monitorApi = () => window.novadeck.monitor

export function useLiveMonitor(connectionId: string, enabled: boolean): LiveMonitor {
  const snapshot = useMonitorStore((state) => state.snapshots.get(connectionId) ?? null)
  const history = useMonitorStore((state) => state.history.get(connectionId) ?? EMPTY)
  const status = useMonitorStore((state) => state.status.get(connectionId))
  const [startFailed, setStartFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const store = useMonitorStore.getState()
    let live = true
    const offData = monitorApi().onData((id, data) => { if (live && id === connectionId) store.pushSnapshot(connectionId, data as MonitorSnapshot) })
    const offStatus = monitorApi().onStatus((id, next) => { if (live && id === connectionId) store.setStatus(connectionId, next as MonitorStatus) })
    const offError = monitorApi().onError((id, error) => { if (live && id === connectionId) store.setError(connectionId, error) })
    void monitorApi().getHistory(connectionId).then((saved) => {
      if (live && saved.length > 0) store.setHistory(connectionId, saved as MonitorSnapshot[])
    })
    void monitorApi().start(connectionId).then((result) => { if (live) setStartFailed(!result.success) })
    return () => {
      live = false
      offData()
      offStatus()
      offError()
      void monitorApi().stop(connectionId).catch(() => {})
    }
  }, [connectionId, enabled])

  const available = !startFailed && !(status && UNAVAILABLE.has(status))
  return { snapshot: available ? snapshot : null, history, available }
}
