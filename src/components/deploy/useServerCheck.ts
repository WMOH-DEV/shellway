import { useCallback, useEffect, useState } from 'react'
import type { DoctorReport, SiteConfig } from '@/types/deploy'
import { readyItems } from '@/utils/deploy/readyCheck'
import { deployApi } from './useDeploySites'

export interface ServerCheckState {
  report: DoctorReport | null
  error: string | null
  hasProblem: boolean
  run: () => Promise<void>
}

export function useServerCheck(connectionId: string, site: SiteConfig): ServerCheckState {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setReport(null)
    setError(null)
    const result = await deployApi().doctor(connectionId, site.name)
    if (result.success && result.data) setReport(result.data)
    else setError(result.error ?? 'Could not check the server')
  }, [connectionId, site.name])

  useEffect(() => { void run() }, [run])

  const hasProblem = report !== null && readyItems({ site, report, access: null, publicKey: '' }).some((item) => item.status === 'fail')
  return { report, error, hasProblem, run }
}
