import { ipcRenderer } from 'electron'
import type { ServerResult } from '../../../src/types/server/core'
import type { ServerNotifications } from '../../../src/types/server/notifications'
import type { ServerPrefs } from '../../../src/utils/server/settings/prefs'

export const settingsApi = {
  notifyTest: (settings: ServerNotifications) =>
    ipcRenderer.invoke('server:settings-notify-test', settings) as Promise<ServerResult>,
  prefs: (sessionKey: string) =>
    ipcRenderer.invoke('server:settings-prefs', sessionKey) as Promise<ServerResult<ServerPrefs>>,
  savePrefs: (sessionKey: string, prefs: ServerPrefs) =>
    ipcRenderer.invoke('server:settings-prefs-save', sessionKey, prefs) as Promise<ServerResult<ServerPrefs>>
}
