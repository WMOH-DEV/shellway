import { randomUUID } from 'crypto'
import { app, ipcMain, type WebContents } from 'electron'
import { join } from 'path'
import type {
  FileNameSearchRequest,
  RemoteSearchEvent,
  SearchCachePatch,
  TextSearchRequest
} from '../../src/types/search'
import { RemoteSearchService } from '../services/search/RemoteSearchService'
import { SearchCacheStore } from '../services/search/SearchCacheStore'
import { sshExec } from '../utils/sshExec'
import { getSSHService } from './ssh.ipc'
import type { RemoteExec } from '../services/deploy/DeployService'

const REMOTE_EVENT_CHANNEL = 'search:remote:event'

let store: SearchCacheStore | null = null
let service: RemoteSearchService | null = null
const owners = new Map<string, WebContents>()
const watchedSenders = new WeakSet<WebContents>()

function execFor(connectionId: string): RemoteExec | null {
  const conn = getSSHService().get(connectionId)
  if (!conn || conn.status !== 'connected') return null
  return (command, options) => sshExec(conn, command, options)
}

function getStore(): SearchCacheStore {
  store ??= new SearchCacheStore(join(app.getPath('userData'), 'search-cache.json'))
  return store
}

export function flushSearchCache(): void {
  store?.flush()
}

function routeEvent(event: RemoteSearchEvent): void {
  const sender = owners.get(event.searchId)
  if (event.kind === 'done') owners.delete(event.searchId)
  if (sender && !sender.isDestroyed()) sender.send(REMOTE_EVENT_CHANNEL, event)
}

function getService(): RemoteSearchService {
  service ??= new RemoteSearchService({ execFor, send: routeEvent, newId: randomUUID })
  return service
}

function cancelSearchesOf(sender: WebContents): void {
  for (const [searchId, owner] of owners) {
    if (owner === sender) getService().cancel(searchId)
  }
}

function adopt(sender: WebContents, searchId: string): void {
  owners.set(searchId, sender)
  if (watchedSenders.has(sender)) return
  watchedSenders.add(sender)
  sender.once('destroyed', () => cancelSearchesOf(sender))
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid request')
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`)
  return value
}

function flag(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}`)
  return value
}

function textList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`Invalid ${label}`)
  return value as string[]
}

function fileRequest(value: unknown): FileNameSearchRequest {
  const raw = record(value)
  return {
    connectionId: text(raw.connectionId, 'connection'),
    root: raw.root === undefined ? undefined : text(raw.root, 'root'),
    text: text(raw.text, 'text'),
    excludes: textList(raw.excludes, 'exclude')
  }
}

function textRequest(value: unknown): TextSearchRequest {
  const raw = record(value)
  return {
    connectionId: text(raw.connectionId, 'connection'),
    root: text(raw.root, 'root'),
    text: text(raw.text, 'text'),
    caseSensitive: flag(raw.caseSensitive, 'case option'),
    wholeWord: flag(raw.wholeWord, 'whole word option'),
    regex: flag(raw.regex, 'regex option'),
    includes: textList(raw.includes, 'include'),
    excludes: textList(raw.excludes, 'exclude')
  }
}

function cachePatch(value: unknown): SearchCachePatch {
  const raw = record(value)
  if (typeof raw.kind !== 'string') throw new Error('Invalid patch')
  return raw as unknown as SearchCachePatch
}

export function registerSearchIPC(): void {
  ipcMain.handle('search:cache:get', () => getStore().get())
  ipcMain.handle('search:cache:apply', (_event, patch: unknown) => getStore().apply(cachePatch(patch)))
  ipcMain.handle('search:cache:clear', () => getStore().clear())
  ipcMain.handle('search:cache:stats', () => getStore().stats())

  ipcMain.handle('search:remote:files', (event, request: unknown) => {
    const started = getService().findFiles(fileRequest(request))
    adopt(event.sender, started.searchId)
    return started
  })
  ipcMain.handle('search:remote:text', (event, request: unknown) => {
    const started = getService().findText(textRequest(request))
    adopt(event.sender, started.searchId)
    return started
  })
  ipcMain.handle('search:remote:cancel', (event, searchId: unknown) => {
    if (typeof searchId === 'string' && owners.get(searchId) === event.sender) getService().cancel(searchId)
  })
  ipcMain.handle('search:remote:preview', (_event, connectionId: unknown, path: unknown, line: unknown, context: unknown) =>
    getService().preview(text(connectionId, 'connection'), text(path, 'path'), line as number, context as number)
  )
}
