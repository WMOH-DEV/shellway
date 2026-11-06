import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/Toast'
import type { RemoteDrift, RunnerInfo, SiteSummary } from '@/types/deploy'

const BUSY_POLL_MS = 4_000
const IDLE_POLL_MS = 30_000
const DRIFT_MIN_INTERVAL_MS = 60_000

export const deployApi = () => window.novadeck.deploy

export interface DeploySites {
  runner: RunnerInfo | null
  sites: SiteSummary[]
  pcDrift: Record<string, RemoteDrift>
  loading: boolean
  installing: boolean
  error: string | null
  refresh: () => Promise<void>
  installRunner: () => Promise<void>
}

async function fetchPcDrift(sites: SiteSummary[]): Promise<Record<string, RemoteDrift>> {
  const pcSites = sites.filter((s) => s.config.sourceMode === 'pc')
  const drifts = await Promise.all(pcSites.map((s) => deployApi().drift(s.config.repoUrl, s.config.branch, s.state.current)))
  return Object.fromEntries(pcSites.flatMap((s, i) => (drifts[i].success && drifts[i].data ? [[s.config.name, drifts[i].data]] : [])))
}

const isBusy = (sites: SiteSummary[]) => sites.some((s) => s.state.busy)
const hasAutoSites = (sites: SiteSummary[]) => sites.some((s) => s.config.sourceMode === 'auto')

export function useDeploySites(connectionId: string, sessionId: string, connected: boolean): DeploySites {
  const [runner, setRunner] = useState<RunnerInfo | null>(null)
  const [sites, setSites] = useState<SiteSummary[]>([])
  const [pcDrift, setPcDrift] = useState<Record<string, RemoteDrift>>({})
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const driftCheckedAt = useRef(0)
  const inFlight = useRef<Promise<void> | null>(null)

  const refreshDrift = useCallback(async (listed: SiteSummary[], force: boolean) => {
    if (!force && Date.now() - driftCheckedAt.current < DRIFT_MIN_INTERVAL_MS) return
    driftCheckedAt.current = Date.now()
    const drift = await fetchPcDrift(listed)
    if (mounted.current) setPcDrift(drift)
  }, [])

  const loadOnce = useCallback(async (forceDrift: boolean) => {
    setLoading(true)
    const info = await deployApi().runnerInfo(connectionId)
    if (!mounted.current) return
    if (!info.success || !info.data) {
      setError(info.error ?? 'Could not reach the server')
      setLoading(false)
      return
    }
    setRunner(info.data)
    if (!info.data.installed) {
      setSites([])
      setPcDrift({})
      setError(null)
      setLoading(false)
      return
    }
    const listed = await deployApi().list(connectionId, sessionId)
    if (!mounted.current) return
    setLoading(false)
    if (!listed.success || !listed.data) {
      setError(listed.error ?? 'Could not read sites')
      return
    }
    setError(null)
    setSites(listed.data)
    await refreshDrift(listed.data, forceDrift)
  }, [connectionId, sessionId, refreshDrift])

  const load = useCallback((forceDrift: boolean): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const running = loadOnce(forceDrift).finally(() => { inFlight.current = null })
    inFlight.current = running
    return running
  }, [loadOnce])

  const refresh = useCallback(() => load(true), [load])

  const installRunner = useCallback(async () => {
    setInstalling(true)
    const result = await deployApi().installRunner(connectionId)
    if (mounted.current) setInstalling(false)
    if (!result.success) {
      toast.error('Could not install the deploy runner', result.error)
      return
    }
    await load(true)
  }, [connectionId, load])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (connected) void load(true)
  }, [connected, load])

  useEffect(() => {
    const offChanged = deployApi().onChanged((id) => { if (id === connectionId) void load(false) })
    const offFinished = deployApi().onFinished((id, site, record) => {
      if (id !== connectionId) return
      const done = record.trigger === 'env' ? 'env change applied' : 'deployed'
      const action = record.trigger === 'env' ? 'env change' : 'deploy'
      if (record.status === 'success') toast.success(`${site} ${done}`)
      else if (record.status === 'warning') toast.warning(`${site} ${done} with warnings`, record.note || undefined)
      else if (record.status === 'waiting') toast.info(`${site} is waiting for approval`, record.note || undefined)
      else if (record.status === 'cancelled') toast.info(`${site} ${action} cancelled`, record.note || undefined)
      else toast.error(`${site} ${action} ${record.status}`, record.note || undefined)
    })
    return () => { offChanged(); offFinished() }
  }, [connectionId, load])

  const pollMs = isBusy(sites) ? BUSY_POLL_MS : hasAutoSites(sites) ? IDLE_POLL_MS : null

  useEffect(() => {
    if (!connected || pollMs === null) return
    const timer = setInterval(() => void load(false), pollMs)
    return () => clearInterval(timer)
  }, [connected, pollMs, load])

  return { runner, sites, pcDrift, loading, installing, error, refresh, installRunner }
}
