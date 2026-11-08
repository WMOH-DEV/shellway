import { ipcRenderer } from 'electron'
import type { ServerResult } from '../../../src/types/server/core'
import type { SiteLogRequest, SiteLogResult } from '../../../src/utils/server/sites/types'

export const sitesApi = {
  tail: (connectionId: string, request: SiteLogRequest) =>
    ipcRenderer.invoke('server:sites:tail', connectionId, request) as Promise<ServerResult<SiteLogResult>>
}
