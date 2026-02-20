import { ipcMain } from 'electron'
import { SettingsStore, type AppSettings } from '../services/SettingsStore'

const settingsStore = new SettingsStore()

/** Get the settings store singleton (for use by other services) */
export function getSettingsStore(): SettingsStore {
  return settingsStore
}

/**
 * Register all settings-related IPC handlers.
 * Channels:
 *   settings:getAll  → AppSettings
 *   settings:update  → AppSettings
 *   settings:reset   → AppSettings
 */
export function registerSettingsIPC(): void {
  ipcMain.handle('settings:getAll', () => {
    return settingsStore.getAll()
  })

  ipcMain.handle('settings:update', (_event, updates: Partial<AppSettings>) => {
    return settingsStore.update(updates)
  })

  ipcMain.handle('settings:reset', () => {
    return settingsStore.reset()
  })
}
