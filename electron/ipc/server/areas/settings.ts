import { ipcMain } from 'electron'
import Store from 'electron-store'
import type { ServerResult } from '../../../../src/types/server/core'
import { parseNotifications } from '../../../../src/utils/server/settings/notifications'
import { DEFAULT_SERVER_PREFS, parseServerPrefs, type ServerPrefs } from '../../../../src/utils/server/settings/prefs'
import type { ServerIpcContext } from '../../../services/server/context'
import { sendNotification } from '../../../services/serverNotify/NotifySender'
import { configureServerNotify } from '../../../services/serverNotify/notifyEvents'
import { getSettingsStore } from '../../settings.ipc'

const TEST_TEXT = 'Shellway test notification. If you can read this, server alerts will reach you here.'

let prefsStore: Store<{ prefs: Record<string, ServerPrefs> }> | null = null

export function getServerPrefs(sessionKey: string): ServerPrefs {
  const saved = prefsStore?.get('prefs')[sessionKey]
  return saved ? { ...DEFAULT_SERVER_PREFS, ...saved } : DEFAULT_SERVER_PREFS
}

export function registerSettingsIPC(_ctx: ServerIpcContext): void {
  prefsStore = new Store<{ prefs: Record<string, ServerPrefs> }>({ name: 'shellway-server-prefs', defaults: { prefs: {} } })
  configureServerNotify(() => getSettingsStore().get('serverNotifications'))

  handle('server:settings-notify-test', async (raw) => {
    const settings = parseNotifications(raw)
    if (settings.kind === 'off') throw new Error('Choose where to send notifications first')
    await sendNotification({ kind: settings.kind, url: settings.url }, 'test', TEST_TEXT)
  })
  handle('server:settings-prefs', (sessionKey) => getServerPrefs(sessionKeyOf(sessionKey)))
  handle('server:settings-prefs-save', (sessionKey, raw) => {
    const key = sessionKeyOf(sessionKey)
    const prefs = parseServerPrefs(raw)
    prefsStore!.set('prefs', { ...prefsStore!.get('prefs'), [key]: prefs })
    return prefs
  })
}

function sessionKeyOf(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) throw new Error('Invalid server')
  return value
}

function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<ServerResult<unknown>> => {
    try {
      return { success: true, data: await fn(...args) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
