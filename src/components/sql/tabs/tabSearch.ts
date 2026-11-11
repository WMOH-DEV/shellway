import type { SQLTab } from '@/types/sql'
import { matchesFuzzy } from '@/utils/fuzzyMatch'
import { tabKind } from './tabModel'
import { kindLabel, tabTitle } from './tabPresentation'

export type TabScope = 'all' | 'tables' | 'queries' | 'unsaved'

export function tabInScope(tab: SQLTab, scope: TabScope): boolean {
  switch (scope) {
    case 'all':
      return true
    case 'tables':
      return tabKind(tab) !== 'query'
    case 'queries':
      return tabKind(tab) === 'query'
    case 'unsaved':
      return tab.isDirty === true
  }
}

export function tabSearchText(tab: SQLTab, filterText: string | undefined): string {
  return `${tabTitle(tab)} ${tab.database ?? ''} ${kindLabel(tabKind(tab))} ${filterText ?? ''}`
}

export function searchTabs(
  orderedByMru: SQLTab[],
  query: string,
  scope: TabScope,
  filterTextById: Record<string, string | undefined>
): SQLTab[] {
  return orderedByMru.filter(
    (tab) => tabInScope(tab, scope) && matchesFuzzy(query, tabSearchText(tab, filterTextById[tab.id]))
  )
}

export function scopeCounts(tabs: SQLTab[]): Record<TabScope, number> {
  const count = (scope: TabScope): number => tabs.filter((tab) => tabInScope(tab, scope)).length
  return { all: count('all'), tables: count('tables'), queries: count('queries'), unsaved: count('unsaved') }
}
