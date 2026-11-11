import type { SQLTab, SQLTabKind } from '@/types/sql'
import { matchesFuzzy } from '@/utils/fuzzyMatch'
import { tabKind } from './tabModel'
import { tabTitle } from './tabPresentation'

export type GroupMode = 'database' | 'kind'

export type VerticalRow =
  | { type: 'group'; key: string; label: string; count: number; collapsed: boolean }
  | { type: 'tab'; key: string; tab: SQLTab; index: number }

interface IndexedTab {
  tab: SQLTab
  index: number
}

interface TabGroup {
  key: string
  label: string
  entries: IndexedTab[]
}

const PINNED_KEY = 'pinned'
const NO_DATABASE_LABEL = 'No database'

const KIND_GROUPS: { kind: SQLTabKind; label: string }[] = [
  { kind: 'table', label: 'Tables' },
  { kind: 'query', label: 'Queries' },
  { kind: 'structure', label: 'Structure' }
]

function matchesFilter(tab: SQLTab, filter: string): boolean {
  return matchesFuzzy(filter, `${tabTitle(tab)} ${tab.database ?? ''}`)
}

function groupByDatabase(entries: IndexedTab[]): TabGroup[] {
  const names = [...new Set(entries.map((e) => e.tab.database ?? ''))]
  const named = names.filter(Boolean).sort((a, b) => a.localeCompare(b))
  const ordered = names.includes('') ? [...named, ''] : named
  return ordered.map((name) => ({
    key: `db:${name}`,
    label: name || NO_DATABASE_LABEL,
    entries: entries.filter((e) => (e.tab.database ?? '') === name)
  }))
}

function groupByKind(entries: IndexedTab[]): TabGroup[] {
  return KIND_GROUPS.map(({ kind, label }) => ({
    key: `kind:${kind}`,
    label,
    entries: entries.filter((e) => tabKind(e.tab) === kind)
  }))
}

function toRows(group: TabGroup, collapsed: boolean): VerticalRow[] {
  const header: VerticalRow = {
    type: 'group',
    key: group.key,
    label: group.label,
    count: group.entries.length,
    collapsed
  }
  if (collapsed) return [header]
  const rows = group.entries.map(
    ({ tab, index }): VerticalRow => ({ type: 'tab', key: `tab:${tab.id}`, tab, index })
  )
  return [header, ...rows]
}

export function buildGroups(
  tabs: SQLTab[],
  mode: GroupMode,
  filter: string,
  collapsed: ReadonlySet<string>
): VerticalRow[] {
  const visible = tabs.map((tab, index) => ({ tab, index })).filter((e) => matchesFilter(e.tab, filter))
  const pinned: TabGroup = {
    key: PINNED_KEY,
    label: 'Pinned',
    entries: visible.filter((e) => e.tab.pinned)
  }
  const unpinned = visible.filter((e) => !e.tab.pinned)
  const rest = mode === 'database' ? groupByDatabase(unpinned) : groupByKind(unpinned)
  return [pinned, ...rest]
    .filter((group) => group.entries.length > 0)
    .flatMap((group) => toRows(group, collapsed.has(group.key)))
}
