import { ipcRenderer } from 'electron'
import type { ServerResult } from '../../../src/types/server/core'

export const setupApi = {
  checkLogin: (connectionId: string, user: string) =>
    ipcRenderer.invoke('server:setup-check-login', connectionId, user) as Promise<ServerResult>
}
