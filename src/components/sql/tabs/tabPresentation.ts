import type { SQLTab, SQLTabKind } from '@/types/sql'
import { tabKind } from './tabModel'

const KIND_BAR_CLASS: Record<SQLTabKind, string> = {
  table: 'bg-nd-accent',
  query: 'bg-nd-new',
  structure: 'bg-nd-success'
}

const KIND_LABEL: Record<SQLTabKind, string> = {
  table: 'table',
  query: 'query',
  structure: 'structure'
}

export function kindBarClass(kind: SQLTabKind): string {
  return KIND_BAR_CLASS[kind]
}

export function kindLabel(kind: SQLTabKind): string {
  return KIND_LABEL[kind]
}

export function tabTitle(tab: SQLTab): string {
  return tab.type === 'data' && tabKind(tab) === 'structure' ? `${tab.label} · structure` : tab.label
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function relativeTime(timestamp: number | undefined, now: number): string {
  if (!timestamp) return ''
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < MINUTE) return 'now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h`
  if (elapsed < 2 * DAY) return 'yesterday'
  return `${Math.floor(elapsed / DAY)} d`
}
