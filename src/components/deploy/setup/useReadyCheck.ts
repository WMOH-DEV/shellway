import { useCallback, useEffect, useState } from 'react'
import type { DoctorReport, SiteConfig } from '@/types/deploy'
import { readyItems, readySummary, type ReadyItem, type ReadySummary } from '@/utils/deploy/readyCheck'
import { useDeployKey, type DeployKey } from '../useDeployKey'
import { deployApi } from '../useDeploySites'

export interface ReadyCheckModel {
  items: ReadyItem[] | null
  summary: ReadySummary | null
  error: string | null
  running: boolean
  deployKey: DeployKey
  run: () => Promise<void>
}

export function useReadyCheck(connectionId: string, site: SiteConfig, active: boolean): ReadyCheckModel {
  const deployKey = useDeployKey(connectionId, site)
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const auto = site.sourceMode === 'auto'
  const { createKey, testAccess } = deployKey

  const run = useCallback(async () => {
    setRunning(true)
    setReport(null)
    setError(null)
    if (auto) await createKey()
    const result = await deployApi().doctor(connectionId, site.name)
    if (result.success && result.data) {
      setReport(result.data)
      if (auto) await testAccess()
    } else {
      setError(result.error ?? 'Could not check the server')
    }
    setRunning(false)
  }, [connectionId, site.name, auto, createKey, testAccess])

  useEffect(() => {
    if (active) void run()
  }, [active, run])

  const items = report ? readyItems({ site, report, access: auto ? deployKey.access : null, publicKey: deployKey.publicKey }) : null
  return { items, summary: items ? readySummary(items) : null, error, running, deployKey, run }
}
