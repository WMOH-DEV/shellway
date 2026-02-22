/** Application theme */
export type Theme = 'dark' | 'light' | 'system'

/** Terminal cursor style */
export type CursorStyle = 'block' | 'underline' | 'bar'

/** SFTP view mode */
export type SFTPViewMode = 'list' | 'grid'

/** Bell behavior */
export type BellBehavior = 'sound' | 'visual' | 'none'

/** Interface density */
export type InterfaceDensity = 'comfortable' | 'compact'

/** SFTP double-click action */
export type SFTPDoubleClickAction = 'open' | 'transfer' | 'edit'

/** SFTP conflict resolution */
export type SFTPConflictResolution = 'ask' | 'overwrite' | 'overwrite-newer' | 'skip' | 'rename'

/** SFTP address bar autocomplete mode */
export type SFTPAutocompleteMode = 'content' | 'history'

/** Application settings — expanded with reconnection, log, and SFTP additions */
export interface AppSettings {
  // General
  theme: Theme
  accentColor: string
  density: InterfaceDensity
  minimizeToTray: boolean
  startOnBoot: boolean
  checkForUpdates: boolean

  // Terminal
  terminalFontFamily: string
  terminalFontSize: number
  terminalLineHeight: number
  terminalScrollback: number
  terminalCursorStyle: CursorStyle
  terminalCursorBlink: boolean
  terminalCopyOnSelect: boolean
  terminalRightClickPaste: boolean
  terminalBell: BellBehavior
  terminalColorScheme: string

  // SFTP
  sftpDefaultViewMode: SFTPViewMode
  sftpShowHiddenFiles: boolean
  sftpConcurrentTransfers: number
  sftpBandwidthLimit: number           // 0 = unlimited, in KB/s (upload)
  sftpDefaultLocalDirectory: string
  sftpDoubleClickAction: SFTPDoubleClickAction
  sftpDefaultConflictResolution: SFTPConflictResolution
  sftpPreserveTimestamps: boolean
  sftpFollowSymlinks: boolean
  sftpBandwidthLimitDown: number       // 0 = unlimited, in KB/s (download)
  sftpDefaultApps: Record<string, string>  // Maps file extension (e.g. '.log') → app path
  sftpAutocompleteMode: SFTPAutocompleteMode  // 'content' = fetch dir listings, 'history' = visited paths only

  // Connection
  connectionKeepAliveInterval: number  // seconds
  connectionTimeout: number            // seconds
  connectionReconnectAttempts: number
  connectionReconnectDelay: number     // seconds

  // Reconnection (exponential backoff)
  reconnectionEnabled: boolean
  reconnectionMaxAttempts: number      // 0 = unlimited
  reconnectionInitialDelay: number     // seconds
  reconnectionMaxDelay: number         // seconds
  reconnectionBackoffMultiplier: number
  reconnectionJitter: boolean

  // Log
  logMaxEntries: number                // Max log entries per session in memory
  logDebugMode: boolean                // Show debug-level SSH protocol events

  // Notifications
  notificationsEnabled: boolean        // Master toggle for desktop notifications
  notifyOnDisconnect: boolean          // Notify when SSH connection drops
  notifyOnTransferComplete: boolean    // Notify when file transfer finishes

  // Session behavior
  sessionAutoSave: boolean             // Auto-save session changes
}

/** Default settings */
export const DEFAULT_SETTINGS: AppSettings = {
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

  sessionAutoSave: true
}
