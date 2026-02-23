import Store from 'electron-store'
import { DEFAULT_KEYBINDINGS } from '../../src/types/keybindings'

/** Application settings shape (matches renderer AppSettings type) */
export interface AppSettings {
  // General
  theme: 'dark' | 'light' | 'system'
  accentColor: string
  density: 'comfortable' | 'compact'
  minimizeToTray: boolean
  startOnBoot: boolean
  checkForUpdates: boolean

  // Terminal
  terminalFontFamily: string
  terminalFontSize: number
  terminalLineHeight: number
  terminalScrollback: number
  terminalCursorStyle: 'block' | 'underline' | 'bar'
  terminalCursorBlink: boolean
  terminalCopyOnSelect: boolean
  terminalRightClickPaste: boolean
  terminalBell: 'sound' | 'visual' | 'none'
  terminalColorScheme: string

  // SFTP
  sftpDefaultViewMode: 'list' | 'grid'
  sftpShowHiddenFiles: boolean
  sftpConcurrentTransfers: number
  sftpBandwidthLimit: number
  sftpDefaultLocalDirectory: string
  sftpDoubleClickAction: 'open' | 'transfer' | 'edit'
  sftpDefaultConflictResolution: 'ask' | 'overwrite' | 'overwrite-newer' | 'skip' | 'rename'
  sftpPreserveTimestamps: boolean
  sftpFollowSymlinks: boolean
  sftpBandwidthLimitDown: number
  sftpDefaultApps: Record<string, string>  // Maps file extension (e.g. '.log') → app path
  sftpAutocompleteMode: 'content' | 'history'

  // Connection
  connectionKeepAliveInterval: number
  connectionTimeout: number
  connectionReconnectAttempts: number
  connectionReconnectDelay: number

  // Reconnection (exponential backoff)
  reconnectionEnabled: boolean
  reconnectionMaxAttempts: number
  reconnectionInitialDelay: number
  reconnectionMaxDelay: number
  reconnectionBackoffMultiplier: number
  reconnectionJitter: boolean

  // Log
  logMaxEntries: number
  logDebugMode: boolean

  // Notifications
  notificationsEnabled: boolean
  notifyOnDisconnect: boolean
  notifyOnTransferComplete: boolean

  // Session behavior
  sessionAutoSave: boolean

  // Keyboard shortcuts (actionId → combo string)
  keybindings: Record<string, string>
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accentColor: '#3b82f6',
  density: 'comfortable',
  minimizeToTray: false,
  startOnBoot: false,
  checkForUpdates: true,

  terminalFontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
  terminalFontSize: 14,
  terminalLineHeight: 1.4,
  terminalScrollback: 10000,
  terminalCursorStyle: 'block',
  terminalCursorBlink: true,
  terminalCopyOnSelect: true,
  terminalRightClickPaste: true,
  terminalBell: 'none',
  terminalColorScheme: 'default',

  sftpDefaultViewMode: 'list',
  sftpShowHiddenFiles: false,
  sftpConcurrentTransfers: 3,
  sftpBandwidthLimit: 0,
  sftpDefaultLocalDirectory: '',
  sftpDoubleClickAction: 'open',
  sftpDefaultConflictResolution: 'ask',
  sftpPreserveTimestamps: true,
  sftpFollowSymlinks: true,
  sftpBandwidthLimitDown: 0,
  sftpDefaultApps: {},
  sftpAutocompleteMode: 'content',

  connectionKeepAliveInterval: 30,
  connectionTimeout: 15,
  connectionReconnectAttempts: 3,
  connectionReconnectDelay: 5,

  reconnectionEnabled: true,
  reconnectionMaxAttempts: 0,
  reconnectionInitialDelay: 1,
  reconnectionMaxDelay: 120,
  reconnectionBackoffMultiplier: 2,
  reconnectionJitter: true,

  logMaxEntries: 5000,
  logDebugMode: false,

  notificationsEnabled: true,
  notifyOnDisconnect: true,
  notifyOnTransferComplete: true,

  sessionAutoSave: true,

  keybindings: { ...DEFAULT_KEYBINDINGS }
}

/**
 * SettingsStore — persists app preferences using electron-store.
 */
export class SettingsStore {
  private store: Store<{ settings: AppSettings }>

  constructor() {
    this.store = new Store<{ settings: AppSettings }>({
      name: 'shellway-settings',
      defaults: {
        settings: DEFAULT_SETTINGS
      }
    })

    // Migrate: old default 'JetBrains Mono' → include fallback fonts
    const saved = this.store.get('settings') as Partial<AppSettings> | undefined
    if (saved?.terminalFontFamily === 'JetBrains Mono') {
      this.store.set('settings.terminalFontFamily', DEFAULT_SETTINGS.terminalFontFamily)
    }
  }

  /** Get all settings (deep-merges keybindings so new actions get defaults) */
  getAll(): AppSettings {
    const saved = this.store.get('settings') as Partial<AppSettings> | undefined
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      keybindings: { ...DEFAULT_SETTINGS.keybindings, ...saved?.keybindings }
    }
  }

  /** Get a single setting value */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    const settings = this.getAll()
    return settings[key]
  }

  /** Update one or more settings */
  update(updates: Partial<AppSettings>): AppSettings {
    const current = this.getAll()
    const updated = { ...current, ...updates }
    this.store.set('settings', updated)
    return updated
  }

  /** Reset all settings to defaults */
  reset(): AppSettings {
    this.store.set('settings', DEFAULT_SETTINGS)
    return DEFAULT_SETTINGS
  }
}
