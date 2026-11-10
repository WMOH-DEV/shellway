import type { ClosedSQLTab, SQLTab, SQLTabKind } from '@/types/sql'

export interface TabsState {
  tabs: SQLTab[]
  activeTabId: string | null
  mru: string[]
  closed: ClosedSQLTab[]
}

export type NewTabPosition = 'next' | 'end'
export type TabPredicate = (tab: SQLTab) => boolean

export const CLOSED_TABS_CAP = 20
export const VIEW_STATE_SQL_CAP = 65_536

export function tabKind(tab: SQLTab): SQLTabKind {
  if (tab.type === 'query') return 'query'
  if (tab.type === 'structure' || tab.viewMode === 'structure') return 'structure'
  return 'table'
}

export function sameTarget(a: SQLTab, b: SQLTab): boolean {
  return (
    a.type === b.type &&
    a.type !== 'query' &&
    a.table === b.table &&
    a.database === b.database &&
    !a.filterScope &&
    !b.filterScope
  )
}

function pinnedCount(tabs: SQLTab[]): number {
  return tabs.filter((t) => t.pinned).length
}

function insertionIndex(s: TabsState, position: NewTabPosition): number {
  const firstUnpinned = pinnedCount(s.tabs)
  if (position === 'end') return s.tabs.length
  const activeIndex = s.tabs.findIndex((t) => t.id === s.activeTabId)
  return Math.max(firstUnpinned, activeIndex + 1)
}

function withTabAt(tabs: SQLTab[], index: number, tab: SQLTab): SQLTab[] {
  return [...tabs.slice(0, index), tab, ...tabs.slice(index)]
}

function updateTab(s: TabsState, id: string, patch: Partial<SQLTab>): TabsState {
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
}

export function activateTab(s: TabsState, id: string, now: number): TabsState {
  if (!s.tabs.some((t) => t.id === id)) return s
  return {
    ...updateTab(s, id, { lastActiveAt: now }),
    activeTabId: id,
    mru: [id, ...s.mru.filter((m) => m !== id)]
  }
}

export function insertTab(s: TabsState, tab: SQLTab, position: NewTabPosition, now: number): TabsState {
  const stamped: SQLTab = { ...tab, pinned: false, createdAt: tab.createdAt ?? now }
  const tabs = withTabAt(s.tabs, insertionIndex(s, position), stamped)
  return activateTab({ ...s, tabs }, stamped.id, now)
}

function isReplaceablePreview(tab: SQLTab, isProtected: TabPredicate): boolean {
  return !!tab.preview && !tab.isDirty && !tab.pinned && !isProtected(tab)
}

export function openPreview(
  s: TabsState,
  tab: SQLTab,
  position: NewTabPosition,
  now: number,
  isProtected: TabPredicate
): TabsState {
  const existing = s.tabs.find((t) => sameTarget(t, tab))
  if (existing) return activateTab(s, existing.id, now)

  const preview: SQLTab = { ...tab, preview: true, pinned: false, createdAt: tab.createdAt ?? now }
  const current = s.tabs.find((t) => t.preview)
  if (!current) return insertTab(s, preview, position, now)
  if (!isReplaceablePreview(current, isProtected)) {
    return insertTab(promoteTab(s, current.id), preview, position, now)
  }

  const replaced: TabsState = {
    ...s,
    tabs: s.tabs.map((t) => (t.id === current.id ? preview : t)),
    mru: s.mru.filter((m) => m !== current.id),
    activeTabId: s.activeTabId === current.id ? null : s.activeTabId
  }
  return activateTab(replaced, preview.id, now)
}

export function promoteTab(s: TabsState, id: string): TabsState {
  const tab = s.tabs.find((t) => t.id === id)
  if (!tab?.preview) return s
  return updateTab(s, id, { preview: false })
}

function nextActiveAfterClose(s: TabsState, remaining: SQLTab[]): string | null {
  if (!s.activeTabId || remaining.some((t) => t.id === s.activeTabId)) return s.activeTabId
  if (remaining.length === 0) return null
  const oldIndex = s.tabs.findIndex((t) => t.id === s.activeTabId)
  return remaining[Math.min(oldIndex, remaining.length - 1)].id
}

export function closeTabs(s: TabsState, ids: string[], now: number): TabsState {
  const closing = new Set(ids)
  const closedEntries: ClosedSQLTab[] = s.tabs
    .map((tab, index) => ({ tab, index, closedAt: now }))
    .filter((entry) => closing.has(entry.tab.id))
    .reverse()
  if (closedEntries.length === 0) return s

  const remaining = s.tabs.filter((t) => !closing.has(t.id))
  return {
    tabs: remaining,
    activeTabId: nextActiveAfterClose(s, remaining),
    mru: s.mru.filter((m) => !closing.has(m)),
    closed: [...closedEntries, ...s.closed].slice(0, CLOSED_TABS_CAP)
  }
}

export function reopenClosed(s: TabsState, now: number): TabsState {
  const [entry, ...rest] = s.closed
  if (!entry) return s
  const popped = { ...s, closed: rest }

  const duplicate = s.tabs.find((t) => t.id === entry.tab.id || sameTarget(t, entry.tab))
  if (duplicate) return activateTab(popped, duplicate.id, now)

  const tab: SQLTab = { ...entry.tab, preview: false, pinned: false }
  const index = Math.max(pinnedCount(s.tabs), Math.min(entry.index, s.tabs.length))
  return activateTab({ ...popped, tabs: withTabAt(s.tabs, index, tab) }, tab.id, now)
}

export function setPinned(s: TabsState, id: string, pinned: boolean): TabsState {
  const tab = s.tabs.find((t) => t.id === id)
  if (!tab) return s
  const others = s.tabs.filter((t) => t.id !== id)
  const updated: SQLTab = { ...tab, pinned, preview: false }
  return { ...s, tabs: withTabAt(others, pinnedCount(others), updated) }
}

export function moveTab(s: TabsState, id: string, toIndex: number): TabsState {
  const tab = s.tabs.find((t) => t.id === id)
  if (!tab) return s
  const others = s.tabs.filter((t) => t.id !== id)
  const pinned = pinnedCount(others)
  const [min, max] = tab.pinned ? [0, pinned] : [pinned, others.length]
  const index = Math.min(max, Math.max(min, toIndex))
  return { ...s, tabs: withTabAt(others, index, tab) }
}

const byLabel = (a: SQLTab, b: SQLTab): number => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })

export function sortByName(s: TabsState): TabsState {
  const pinned = s.tabs.filter((t) => t.pinned).sort(byLabel)
  const rest = s.tabs.filter((t) => !t.pinned).sort(byLabel)
  return { ...s, tabs: [...pinned, ...rest] }
}

function lastUsed(tab: SQLTab): number {
  return tab.lastActiveAt ?? tab.createdAt ?? 0
}

function leastRecentlyUsedEvictable(s: TabsState, isProtected: TabPredicate): SQLTab | undefined {
  return s.tabs
    .filter((t) => !t.pinned && !t.isDirty && t.id !== s.activeTabId && !isProtected(t))
    .reduce<SQLTab | undefined>((oldest, t) => (!oldest || lastUsed(t) < lastUsed(oldest) ? t : oldest), undefined)
}

export function enforceLimit(
  s: TabsState,
  limit: number,
  isProtected: TabPredicate,
  now: number
): { state: TabsState; overLimit: boolean } {
  if (limit <= 0) return { state: s, overLimit: false }
  let current = s
  while (current.tabs.length > limit) {
    const victim = leastRecentlyUsedEvictable(current, isProtected)
    if (!victim) return { state: current, overLimit: true }
    current = closeTabs(current, [victim.id], now)
  }
  return { state: current, overLimit: false }
}

export function mruTabs(s: TabsState): SQLTab[] {
  const byId = new Map(s.tabs.map((t) => [t.id, t]))
  const recent = s.mru.map((id) => byId.get(id)).filter((t): t is SQLTab => !!t)
  const seen = new Set(recent.map((t) => t.id))
  return [...recent, ...s.tabs.filter((t) => !seen.has(t.id))]
}
