import type { AppSettings, CursorStyle, BellBehavior, SFTPViewMode } from '@/types/settings'

/**
 * Per-session override shapes.
 * These mirror the SessionOverrides interface from the session model.
 */
export interface TerminalOverrides {
  fontFamily?: string
  fontSize?: number
  lineHeight?: number
  cursorStyle?: CursorStyle
  cursorBlink?: boolean
  scrollbackLines?: number
  colorScheme?: string
  copyOnSelect?: boolean
  rightClickPaste?: boolean
  bellBehavior?: BellBehavior
}

export interface SFTPOverrides {
  defaultViewMode?: SFTPViewMode
  showHiddenFiles?: boolean
  doubleClickAction?: 'open' | 'transfer' | 'edit'
  defaultConflictResolution?: 'ask' | 'overwrite' | 'overwrite-newer' | 'skip' | 'rename'
  concurrentTransfers?: number
  bandwidthLimitUp?: number
  bandwidthLimitDown?: number
  preserveTimestamps?: boolean
  followSymlinks?: boolean
}

export interface SSHOverrides {
  keepAliveInterval?: number
  keepAliveCountMax?: number
  connectionTimeout?: number
  reconnectAttempts?: number
  reconnectDelay?: number
  compression?: boolean
  preferredCiphers?: string[]
  preferredKex?: string[]
  preferredHmac?: string[]
  preferredHostKey?: string[]
}

export interface ConnectionOverrides {
  proxyType?: 'none' | 'socks4' | 'socks5' | 'http'
  proxyHost?: string
  proxyPort?: number
  proxyUsername?: string
  proxyPassword?: string
}

export interface SessionOverrides {
  terminal?: TerminalOverrides
  sftp?: SFTPOverrides
  ssh?: SSHOverrides
  connection?: ConnectionOverrides
}

// ── Resolved (concrete) types — all fields required ──

export interface ResolvedTerminalSettings {
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  scrollbackLines: number
  colorScheme: string
  copyOnSelect: boolean
  rightClickPaste: boolean
  bellBehavior: BellBehavior
}

export interface ResolvedSFTPSettings {
  defaultViewMode: SFTPViewMode
  showHiddenFiles: boolean
  doubleClickAction: 'open' | 'transfer' | 'edit'
  defaultConflictResolution: 'ask' | 'overwrite' | 'overwrite-newer' | 'skip' | 'rename'
  concurrentTransfers: number
  bandwidthLimitUp: number
  bandwidthLimitDown: number
  preserveTimestamps: boolean
  followSymlinks: boolean
}

export interface ResolvedSSHSettings {
  keepAliveInterval: number
  keepAliveCountMax: number
  connectionTimeout: number
  reconnectAttempts: number
  reconnectDelay: number
  compression: boolean
  preferredCiphers: string[]
  preferredKex: string[]
  preferredHmac: string[]
  preferredHostKey: string[]
}

export interface ResolvedConnectionSettings {
  proxyType: 'none' | 'socks4' | 'socks5' | 'http'
  proxyHost: string
  proxyPort: number
  proxyUsername: string
  proxyPassword: string
}

// ── Resolve functions ──

/**
 * Resolve terminal settings: extract globals, overlay session overrides.
 * Session values win where defined (not undefined).
 */
export function resolveTerminalSettings(
  global: AppSettings,
  overrides?: TerminalOverrides
): ResolvedTerminalSettings {
  const base: ResolvedTerminalSettings = {
    fontFamily: global.terminalFontFamily,
    fontSize: global.terminalFontSize,
    lineHeight: global.terminalLineHeight,
    cursorStyle: global.terminalCursorStyle,
    cursorBlink: global.terminalCursorBlink,
    scrollbackLines: global.terminalScrollback,
    colorScheme: global.terminalColorScheme,
    copyOnSelect: global.terminalCopyOnSelect,
    rightClickPaste: global.terminalRightClickPaste,
    bellBehavior: global.terminalBell
  }

  if (!overrides) return base

  return applyOverrides(base, overrides)
}

/**
 * Resolve SFTP settings: extract globals, overlay session overrides.
 */
export function resolveSFTPSettings(
  global: AppSettings,
  overrides?: SFTPOverrides
): ResolvedSFTPSettings {
  const base: ResolvedSFTPSettings = {
    defaultViewMode: global.sftpDefaultViewMode,
    showHiddenFiles: global.sftpShowHiddenFiles,
    doubleClickAction: global.sftpDoubleClickAction ?? 'open',
    defaultConflictResolution: global.sftpDefaultConflictResolution ?? 'ask',
    concurrentTransfers: global.sftpConcurrentTransfers,
    bandwidthLimitUp: global.sftpBandwidthLimit,
    bandwidthLimitDown: global.sftpBandwidthLimitDown,
    preserveTimestamps: global.sftpPreserveTimestamps ?? true,
    followSymlinks: global.sftpFollowSymlinks ?? true
  }

  if (!overrides) return base

  return applyOverrides(base, overrides)
}

/**
 * Resolve SSH settings: extract globals, overlay session overrides.
 */
export function resolveSSHSettings(
  global: AppSettings,
  overrides?: SSHOverrides
): ResolvedSSHSettings {
  const base: ResolvedSSHSettings = {
    keepAliveInterval: global.connectionKeepAliveInterval,
    keepAliveCountMax: 3,
    connectionTimeout: global.connectionTimeout,
    reconnectAttempts: global.connectionReconnectAttempts,
    reconnectDelay: global.connectionReconnectDelay,
    compression: false,
    preferredCiphers: [],
    preferredKex: [],
    preferredHmac: [],
    preferredHostKey: []
  }

  if (!overrides) return base

  return applyOverrides(base, overrides)
}

/**
 * Resolve connection/proxy settings: extract globals, overlay session overrides.
 */
export function resolveConnectionSettings(
  _global: AppSettings,
  overrides?: ConnectionOverrides
): ResolvedConnectionSettings {
  const base: ResolvedConnectionSettings = {
    proxyType: 'none',
    proxyHost: '',
    proxyPort: 1080,
    proxyUsername: '',
    proxyPassword: ''
  }

  if (!overrides) return base

  return applyOverrides(base, overrides)
}

// ── Internal helper ──

/**
 * Generic overlay: for each key in overrides, if the value is not undefined,
 * replace the base value.
 */
function applyOverrides<T>(base: T, overrides: Partial<T>): T {
  const result = { ...base }
  for (const key of Object.keys(overrides) as Array<keyof T>) {
    const value = overrides[key]
    if (value !== undefined) {
      ;(result as any)[key] = value
    }
  }
  return result
}
