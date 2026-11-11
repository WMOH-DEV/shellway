import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppSettings } from '@/types/settings'

export type SqlTabSettings = Pick<
  AppSettings,
  | 'sqlTabLayout'
  | 'sqlPreviewTabs'
  | 'sqlTabLimit'
  | 'sqlNewTabPosition'
  | 'sqlColorByKind'
  | 'sqlReopenTabsOnConnect'
  | 'sqlCloseOnMiddleClick'
>

const SETTING_KEYS: (keyof SqlTabSettings)[] = [
  'sqlTabLayout',
  'sqlPreviewTabs',
  'sqlTabLimit',
  'sqlNewTabPosition',
  'sqlColorByKind',
  'sqlReopenTabsOnConnect',
  'sqlCloseOnMiddleClick'
]

function pickTabSettings(settings: Partial<AppSettings> | null | undefined): SqlTabSettings {
  const picked = {} as Record<keyof SqlTabSettings, unknown>
  for (const key of SETTING_KEYS) {
    const value = settings?.[key]
    picked[key] = typeof value === typeof DEFAULT_SETTINGS[key] ? value : DEFAULT_SETTINGS[key]
  }
  if (picked.sqlTabLayout !== 'vertical') picked.sqlTabLayout = 'single'
  return picked as SqlTabSettings
}

export const useSqlTabSettingsStore = create<SqlTabSettings>(() => pickTabSettings(DEFAULT_SETTINGS))

let started = false

export function loadSqlTabSettings(): void {
  if (started || !window.novadeck?.settings) return
  started = true
  window.novadeck.settings.onChanged?.((settings) => useSqlTabSettingsStore.setState(pickTabSettings(settings)))
  window.novadeck.settings
    .getAll()
    .then((settings) => useSqlTabSettingsStore.setState(pickTabSettings(settings)))
    .catch(() => {})
}

export function getSqlTabSettings(): SqlTabSettings {
  return useSqlTabSettingsStore.getState()
}

export function useSqlTabSettings(): SqlTabSettings {
  loadSqlTabSettings()
  return useSqlTabSettingsStore()
}
