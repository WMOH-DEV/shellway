import { useEffect, useState } from 'react'
import { siteWorkDir, type SitePath } from '@/utils/server/jobs/view'

export function useSitePaths(connectionId: string, sessionId: string, enabled: boolean): SitePath[] {
  const [sites, setSites] = useState<SitePath[]>([])

  useEffect(() => {
    if (!enabled) return
    let live = true
    void window.novadeck.deploy.list(connectionId, sessionId).then((result) => {
      if (!live || !result.success || !result.data) return
      setSites(result.data.map(({ config }) => ({ name: config.name, path: config.path, workDir: siteWorkDir(config.path, config.layout) })))
    })
    return () => {
      live = false
    }
  }, [connectionId, sessionId, enabled])

  return sites
}
