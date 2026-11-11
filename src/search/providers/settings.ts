import { useUIStore } from '@/stores/uiStore'
import { buildCollection, memoIndex, searchCollection } from '../miniIndex'
import { SETTINGS_ENTRIES, sectionLabel, type SettingsEntry } from '../registries/settingsEntries'
import type { SearchAction, SearchProvider, SearchQuery, SearchResult } from '../types'
import { localSearch, MAX_RESULTS } from './shared'

function toResult(entry: SettingsEntry): SearchResult {
  return {
    id: `setting:${entry.id}`,
    providerId: 'settings',
    title: entry.label,
    subtitle: `Settings › ${sectionLabel(entry.section)}`,
    icon: 'setting',
    keywords: entry.keywords,
    scoreHints: {},
    payload: { section: entry.section }
  }
}

function compute(query: SearchQuery): SearchResult[] {
  if (!query.text) return []
  const collection = memoIndex('settings', [SETTINGS_ENTRIES], () => buildCollection(SETTINGS_ENTRIES, ['label', 'keywords']))
  return searchCollection(collection, query.text, MAX_RESULTS).map(toResult)
}

export function createSettingsProvider(): SearchProvider {
  return {
    id: 'settings',
    kind: 'local',
    scopes: ['settings'],
    search: localSearch(compute),
    actions(result): SearchAction[] {
      const { section } = result.payload as { section: string }
      return [{ id: 'open', label: 'Open', role: 'primary', run: () => useUIStore.getState().openSettings(section) }]
    }
  }
}
