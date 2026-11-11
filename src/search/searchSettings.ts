import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppSettings } from '@/types/settings'
import type { ScopeId } from './types'

export interface SearchSettings {
  disabledScopes: ScopeId[]
  excludeGlobs: string[]
}

export function parseGlobList(value: string): string[] {
  return value
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
}

function pickSearchSettings(settings: Partial<AppSettings> | null | undefined): SearchSettings {
  const scopes = Array.isArray(settings?.searchDisabledScopes) ? settings.searchDisabledScopes : DEFAULT_SETTINGS.searchDisabledScopes
  const globs = typeof settings?.searchExcludeGlobs === 'string' ? settings.searchExcludeGlobs : DEFAULT_SETTINGS.searchExcludeGlobs
  return { disabledScopes: scopes as ScopeId[], excludeGlobs: parseGlobList(globs) }
}

export const useSearchSettingsStore = create<SearchSettings>(() => pickSearchSettings(DEFAULT_SETTINGS))

let started = false

export function loadSearchSettings(): void {
  if (started || !window.novadeck?.settings) return
  started = true
  window.novadeck.settings.onChanged?.((settings) => useSearchSettingsStore.setState(pickSearchSettings(settings)))
  window.novadeck.settings
    .getAll()
    .then((settings) => useSearchSettingsStore.setState(pickSearchSettings(settings)))
    .catch(() => {})
}

export function getSearchSettings(): SearchSettings {
  return useSearchSettingsStore.getState()
}
