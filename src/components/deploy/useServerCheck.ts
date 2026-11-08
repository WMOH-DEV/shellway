import { useCallback, useEffect, useState } from 'react'
import type { DoctorReport, SiteConfig } from '@/types/deploy'
import { readyItems } from '@/utils/deploy/readyCheck'
import type { WebServerCheck } from '@/utils/webServer/siteFolder'
import { deployApi } from './useDeploySites'

export interface ServerCheckState {
  report: DoctorReport | null
  webServer: WebServerCheck | null
  error: string | null
  hasProblem: boolean
  run: () => Promise<void>
}

export function useServerCheck(connectionId: string, site: SiteConfig): ServerCheckState {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [webServer, setWebServer] = useState<WebServerCheck | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setReport(null)
    setWebServer(null)
    setError(null)
    const [result, web] = await Promise.all([deployApi().doctor(connectionId, site.name), deployApi().webServerCheck(connectionId, site.name)])
    if (result.success && result.data) setReport(result.data)
    else setError(result.error ?? 'Could not check the server')
    if (web.success && web.data) setWebServer(web.data)
  }, [connectionId, site.name])

  useEffect(() => { void run() }, [run])

  const hasProblem = report !== null && readyItems({ site, report, access: null, publicKey: '' }).some((item) => item.status === 'fail')
  return { report, webServer, error, hasProblem, run }
}
