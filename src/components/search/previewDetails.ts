import type { SearchCacheSnapshot } from '@/types/search'
import type { SearchResult } from '@/search/types'

export type PreviewBody =
  | { kind: 'columns'; columns: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'none' }

const SUBTITLE_SEPARATOR = ' · '

function payloadString(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value ? value : null
}

function idParts(id: string): string[] {
  return id.split(':')
}

function tableColumns(result: SearchResult, snapshot: SearchCacheSnapshot | null): string[] {
  const [kind, scope, database, ...rest] = idParts(result.id)
  const rawName = rest.join(':')
  const table = kind === 'column' ? rawName.slice(0, Math.max(0, rawName.lastIndexOf('.'))) : rawName
  return snapshot?.tables[scope]?.[database]?.find((t) => t.name === table)?.columns ?? []
}

function filePath(result: SearchResult): string {
  const [, , ...rest] = idParts(result.id)
  return rest.join(':')
}

export function describeResult(result: SearchResult, snapshot: SearchCacheSnapshot | null): PreviewBody {
  switch (result.providerId) {
    case 'tables': {
      const columns = tableColumns(result, snapshot)
      return columns.length > 0 ? { kind: 'columns', columns } : { kind: 'none' }
    }
    case 'queries':
    case 'history':
      return { kind: 'code', text: payloadString(result.payload, 'sql') ?? result.title }
    case 'snippets': {
      const command = payloadString(result.payload, 'command')
      return command ? { kind: 'code', text: command } : { kind: 'none' }
    }
    case 'files':
      return { kind: 'text', text: filePath(result) }
    case 'sessions':
      return { kind: 'text', text: result.subtitle.split(SUBTITLE_SEPARATOR)[0] }
    default:
      return { kind: 'none' }
  }
}
