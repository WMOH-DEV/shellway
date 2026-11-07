import { ipcRenderer } from 'electron'
import type { ServerResult } from '../../../src/types/server/core'

export const activityApi = {
  exportFile: (format: 'json' | 'txt', fileName: string, content: string) =>
    ipcRenderer.invoke('server:activity-export', format, fileName, content) as Promise<ServerResult<{ saved: boolean }>>
}
