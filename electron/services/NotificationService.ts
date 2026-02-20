import { Notification, BrowserWindow } from 'electron'
import type { SettingsStore } from './SettingsStore'

/**
 * Manages desktop notifications for SSH events.
 * Only shows notifications when the app window is NOT focused.
 *
 * Usage:
 *   import { initNotificationService, getNotificationService } from './NotificationService'
 *   initNotificationService(settingsStore)     // once in main.ts
 *   getNotificationService().notifyDisconnect() // anywhere
 */
export class NotificationService {
  private settingsStore: SettingsStore

  constructor(settingsStore: SettingsStore) {
    this.settingsStore = settingsStore
  }

  /** Show a disconnect notification. */
  notifyDisconnect(sessionName: string): void {
    const settings = this.settingsStore.getAll()
    if (!settings.notificationsEnabled || !settings.notifyOnDisconnect) return
    if (this.isWindowFocused()) return

    this.show({
      title: 'Connection Lost',
      body: `Connection to ${sessionName} lost`
    })
  }

  /** Show a transfer complete notification. */
  notifyTransferComplete(filename: string): void {
    const settings = this.settingsStore.getAll()
    if (!settings.notificationsEnabled || !settings.notifyOnTransferComplete) return
    if (this.isWindowFocused()) return

    this.show({
      title: 'Transfer Complete',
      body: `Transfer complete: ${filename}`
    })
  }

  private isWindowFocused(): boolean {
    const windows = BrowserWindow.getAllWindows()
    return windows.some((w) => w.isFocused())
  }

  private show(options: { title: string; body: string }): void {
    if (!Notification.isSupported()) return

    const notification = new Notification({
      title: options.title,
      body: options.body,
      silent: false
    })

    notification.show()
  }
}

// ── Singleton access ──

let instance: NotificationService | null = null

/** Initialize the notification service (call once from main.ts) */
export function initNotificationService(settingsStore: SettingsStore): void {
  instance = new NotificationService(settingsStore)
}

/** Get the notification service singleton. Returns null if not initialized. */
export function getNotificationService(): NotificationService | null {
  return instance
}
