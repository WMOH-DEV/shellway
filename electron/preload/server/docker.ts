import { ipcRenderer } from 'electron'
import type { ServerResult } from '../../../src/types/server/core'
import type { ManifestCheck } from '../../../src/utils/server/docker/manifest'

function listen<A extends unknown[]>(channel: string, callback: (...args: A) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

export const dockerApi = {
  startLogs: (connectionId: string, key: string, container: string, follow: boolean) =>
    ipcRenderer.invoke('server:docker:logs-start', connectionId, key, container, follow) as Promise<ServerResult<string>>,
  stopLogs: (key: string) => ipcRenderer.invoke('server:docker:logs-stop', key) as Promise<ServerResult>,
  onLogData: (callback: (streamId: string, chunk: string) => void) => listen<[string, string]>('server:docker:logs-data', callback),
  onLogEnd: (callback: (streamId: string, message: string | null) => void) => listen<[string, string | null]>('server:docker:logs-end', callback),
  manifest: (connectionId: string, reference: string) =>
    ipcRenderer.invoke('server:docker:manifest', connectionId, reference) as Promise<ServerResult<ManifestCheck>>
}
