import type { ActivityEntry, ActivityQuery, ServerArea } from '@/types/server/core'

export type ActivityView = 'all' | 'failed' | 'you' | 'auto'

export type ActivityAreaFilter = ServerArea | 'any'

export interface ActivityFilter {
  view: ActivityView
  area: ActivityAreaFilter
  text: string
}

export const ACTIVITY_PAGE_SIZE = 50

export function toActivityQuery(filter: ActivityFilter, before?: number): ActivityQuery {
  const text = filter.text.trim()
  return {
    limit: ACTIVITY_PAGE_SIZE,
    ...(before !== undefined && { before }),
    ...(filter.area !== 'any' && { area: filter.area }),
    ...(filter.view === 'failed' && { status: 'failed' as const }),
    ...(text !== '' && { text })
  }
}

export function matchesView(entry: ActivityEntry, view: ActivityView): boolean {
  if (view === 'you') return entry.who === 'you'
  if (view === 'auto') return entry.who !== 'you'
  if (view === 'failed') return entry.status === 'failed'
  return true
}

export function mergeEntries(current: ActivityEntry[], incoming: ActivityEntry[]): ActivityEntry[] {
  const byId = new Map(current.map((entry) => [entry.id, entry]))
  for (const entry of incoming) byId.set(entry.id, entry)
  return [...byId.values()].sort((a, b) => b.at - a.at)
}

export function oldestAt(newestFirst: ActivityEntry[]): number | undefined {
  return newestFirst[newestFirst.length - 1]?.at
}

export function countFailed(entries: ActivityEntry[]): number {
  return entries.filter((entry) => entry.status === 'failed').length
}
