import { ipcRenderer } from 'electron'
import type { ServerResult } from '../../../src/types/server/core'

export const databasesApi = {
  downloadBackup: (connectionId: string, path: string) =>
    ipcRenderer.invoke('server:databases:download', connectionId, path) as Promise<ServerResult<{ savedTo: string } | null>>
}
