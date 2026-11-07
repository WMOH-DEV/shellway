import { ipcRenderer } from 'electron'
import type { ServerResult } from '../../../src/types/server/core'
import { LOG_CHANNEL, type LogEnd, type LogReadResult, type LogSource } from '../../../src/utils/server/services/logChannel'

function listen<A extends unknown[]>(channel: string, callback: (...args: A) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...(args as A))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

export const servicesApi = {
  readLog: (connectionId: string, source: LogSource, lines: number) =>
    ipcRenderer.invoke(LOG_CHANNEL.read, connectionId, source, lines) as Promise<ServerResult<LogReadResult>>,
  followLog: (connectionId: string, tabId: string, source: LogSource) =>
    ipcRenderer.invoke(LOG_CHANNEL.follow, connectionId, tabId, source) as Promise<ServerResult<{ followId: string }>>,
  stopLog: (followId: string) => ipcRenderer.invoke(LOG_CHANNEL.stop, followId) as Promise<ServerResult>,
  onLogChunk: (callback: (followId: string, chunk: string) => void) => listen<[string, string]>(LOG_CHANNEL.chunk, callback),
  onLogEnd: (callback: (followId: string, end: LogEnd) => void) => listen<[string, LogEnd]>(LOG_CHANNEL.end, callback)
}
