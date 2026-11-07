import { ipcRenderer } from 'electron'
import type { ServerResult } from '../../../src/types/server/core'
import type { LogTarget } from '../../../src/utils/server/jobs/logs'

export const jobsApi = {
  tail: (connectionId: string, target: LogTarget) => ipcRenderer.invoke('server:jobs:tail', connectionId, target) as Promise<ServerResult<string>>
}
