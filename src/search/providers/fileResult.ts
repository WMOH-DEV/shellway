import { sendIntent } from '../intentStore'
import type { SearchAction, SearchQuery, SearchResult } from '../types'
import { copyText, isScopeConnected, scopeName } from './shared'

interface FilePayload {
  scopeId: string
  path: string
  isDirectory: boolean
}

function splitPath(path: string): { directory: string; base: string } {
  const slash = path.lastIndexOf('/')
  return { directory: path.slice(0, slash) || '/', base: path.slice(slash + 1) || '/' }
}

export function toFileResult(rawPath: string, scopeId: string, query: SearchQuery): SearchResult {
  const isDirectory = rawPath.length > 1 && rawPath.endsWith('/')
  const path = isDirectory ? rawPath.replace(/\/+$/, '') : rawPath
  const { directory, base } = splitPath(path)
  const connected = isScopeConnected(scopeId)
  const payload: FilePayload = { scopeId, path, isDirectory }
  return {
    id: `file:${scopeId}:${rawPath}`,
    providerId: 'files',
    title: base,
    subtitle: `${directory} · ${scopeName(scopeId)}`,
    icon: isDirectory ? 'folder' : 'file',
    hint: connected ? undefined : 'disconnected',
    keywords: path,
    scoreHints: { context: scopeId === query.context.activeSessionId ? 1 : 0, disconnected: !connected },
    payload
  }
}

export function fileActions(result: { payload: unknown }): SearchAction[] {
  const { scopeId, path, isDirectory } = result.payload as FilePayload
  const actions: SearchAction[] = [
    { id: 'reveal', label: 'Reveal in SFTP', role: 'primary', run: () => sendIntent(scopeId, { kind: 'sftp-reveal', path: isDirectory ? `${path}/` : path }) }
  ]
  if (!isDirectory) {
    actions.push({ id: 'open-editor', label: 'Open in editor', role: 'secondary', run: () => sendIntent(scopeId, { kind: 'sftp-open', path }) })
  }
  actions.push({ id: 'copy-path', label: 'Copy path', role: 'copy', run: () => copyText(path) })
  return actions
}
