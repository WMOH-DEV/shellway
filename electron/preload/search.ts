import { ipcRenderer } from 'electron'
import type {
  FileNameSearchRequest,
  PreviewLine,
  RemoteSearchEvent,
  RemoteSearchStarted,
  SearchCachePatch,
  SearchCacheSnapshot,
  SearchCacheStats,
  TextSearchRequest
} from '../../src/types/search'

export const searchApi = {
  cacheGet: () => ipcRenderer.invoke('search:cache:get') as Promise<SearchCacheSnapshot>,
  cacheApply: (patch: SearchCachePatch) => ipcRenderer.invoke('search:cache:apply', patch) as Promise<void>,
  cacheClear: () => ipcRenderer.invoke('search:cache:clear') as Promise<void>,
  cacheStats: () => ipcRenderer.invoke('search:cache:stats') as Promise<SearchCacheStats>,
  findFiles: (request: FileNameSearchRequest) =>
    ipcRenderer.invoke('search:remote:files', request) as Promise<RemoteSearchStarted>,
  findText: (request: TextSearchRequest) =>
    ipcRenderer.invoke('search:remote:text', request) as Promise<RemoteSearchStarted>,
  cancel: (searchId: string) => ipcRenderer.invoke('search:remote:cancel', searchId) as Promise<void>,
  preview: (connectionId: string, path: string, line: number, context: number) =>
    ipcRenderer.invoke('search:remote:preview', connectionId, path, line, context) as Promise<PreviewLine[]>,
  onEvent: (callback: (event: RemoteSearchEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: RemoteSearchEvent) => callback(event)
    ipcRenderer.on('search:remote:event', handler)
    return () => ipcRenderer.removeListener('search:remote:event', handler)
  }
}
