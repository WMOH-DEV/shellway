import { ipcRenderer } from 'electron'
import type { ServerResult } from '../../../src/types/server/core'
import type { GuardPreview, GuardRequest, GuardRun, SecuritySessionInfo } from '../../../src/utils/server/security/guard'

export const securityApi = {
  session: (connectionId: string) => ipcRenderer.invoke('server:security:session', connectionId) as Promise<ServerResult<SecuritySessionInfo>>,
  preview: (connectionId: string, request: GuardRequest) => ipcRenderer.invoke('server:security:guard-preview', connectionId, request) as Promise<ServerResult<GuardPreview>>,
  run: (connectionId: string, sessionKey: string, request: GuardRequest) => ipcRenderer.invoke('server:security:guard-run', connectionId, sessionKey, request) as Promise<ServerResult<{ runId: string }>>,
  current: (connectionId: string) => ipcRenderer.invoke('server:security:guard-current', connectionId) as Promise<ServerResult<GuardRun | null>>,
  onGuard: (callback: (run: GuardRun) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, run: GuardRun) => callback(run)
    ipcRenderer.on('server:security:guard-update', handler)
    return () => {
      ipcRenderer.removeListener('server:security:guard-update', handler)
    }
  }
}
