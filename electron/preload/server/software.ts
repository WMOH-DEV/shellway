import { ipcRenderer } from 'electron'
import type { ServerResult } from '../../../src/types/server/core'
import type { PackageHit } from '../../../src/utils/server/software/types'

export const softwareApi = {
  search: (connectionId: string, query: string) => ipcRenderer.invoke('server:software:search', connectionId, query) as Promise<ServerResult<PackageHit[]>>
}
