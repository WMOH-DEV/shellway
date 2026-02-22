import { ipcMain, app } from 'electron'
import { SettingsStore, type AppSettings } from '../services/SettingsStore'
import { getLogService } from '../services/LogService'

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
    const result = settingsStore.update(updates)

    // startOnBoot — sync OS login item when changed
    if ('startOnBoot' in updates) {
      app.setLoginItemSettings({ openAtLogin: !!updates.startOnBoot })
    }

    // logMaxEntries — update LogService cap when changed
    if ('logMaxEntries' in updates && typeof updates.logMaxEntries === 'number') {
      getLogService().setMaxEntries(updates.logMaxEntries)
    }

    // logDebugMode — update LogService debug filtering when changed
    if ('logDebugMode' in updates && typeof updates.logDebugMode === 'boolean') {
      getLogService().setDebugMode(updates.logDebugMode)
    }

    // minimizeToTray — toggle tray + close behavior at runtime
    if ('minimizeToTray' in updates) {
      const setTray = (global as any).__shellway_setMinimizeToTray
      if (setTray) setTray(!!updates.minimizeToTray)
    }

    // checkForUpdates — placeholder: auto-update integration requires electron-updater
    // setup which is out of scope. This setting is persisted but not yet wired to an
    // actual update mechanism.

    return result
  })

  ipcMain.handle('settings:reset', () => {
    return settingsStore.reset()
  })
}
