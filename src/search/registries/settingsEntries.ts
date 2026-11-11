export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'sftp', label: 'SFTP' },
  { id: 'sql', label: 'SQL' },
  { id: 'connection', label: 'Connection' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'search', label: 'Search' },
  { id: 'about', label: 'About' }
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id']

export interface SettingsEntry {
  id: string
  label: string
  section: SettingsSectionId
  keywords: string
}

export function sectionLabel(section: SettingsSectionId): string {
  return SETTINGS_SECTIONS.find((s) => s.id === section)?.label ?? section
}

const sectionEntries: SettingsEntry[] = SETTINGS_SECTIONS.map((section) => ({
  id: `section-${section.id}`,
  label: `${section.label} settings`,
  section: section.id,
  keywords: 'settings preferences section'
}))

const notableEntries: SettingsEntry[] = [
  { id: 'minimize-to-tray', label: 'Minimize to system tray', section: 'general', keywords: 'tray background hide' },
  { id: 'start-on-boot', label: 'Start on system boot', section: 'general', keywords: 'startup login autostart' },
  { id: 'auto-update', label: 'Check for updates automatically', section: 'general', keywords: 'upgrade version release' },
  { id: 'classic-server-tabs', label: 'Show classic Monitor, Services, Deploy, SSL and Info tabs', section: 'general', keywords: 'server tab legacy' },
  { id: 'notifications', label: 'Enable desktop notifications', section: 'general', keywords: 'alerts notify' },
  { id: 'notify-connection-lost', label: 'Notify on connection lost', section: 'general', keywords: 'disconnect notification' },
  { id: 'notify-transfer-complete', label: 'Notify on transfer complete', section: 'general', keywords: 'upload download notification' },
  { id: 'max-log-entries', label: 'Max log entries per session', section: 'general', keywords: 'logging history limit' },
  { id: 'debug-ssh-events', label: 'Show debug-level SSH events', section: 'general', keywords: 'logging verbose' },
  { id: 'theme', label: 'Theme', section: 'appearance', keywords: 'dark light system colour mode' },
  { id: 'accent-color', label: 'Accent colour', section: 'appearance', keywords: 'color highlight custom' },
  { id: 'interface-density', label: 'Interface density', section: 'appearance', keywords: 'compact comfortable spacing' },
  { id: 'terminal-font', label: 'Terminal font family', section: 'terminal', keywords: 'typeface monospace' },
  { id: 'terminal-font-size', label: 'Terminal font size', section: 'terminal', keywords: 'text zoom' },
  { id: 'terminal-line-height', label: 'Terminal line height', section: 'terminal', keywords: 'spacing' },
  { id: 'terminal-scrollback', label: 'Terminal scrollback', section: 'terminal', keywords: 'buffer history lines' },
  { id: 'terminal-color-scheme', label: 'Terminal color scheme', section: 'terminal', keywords: 'theme palette' },
  { id: 'cursor-style', label: 'Cursor style', section: 'terminal', keywords: 'block underline bar' },
  { id: 'cursor-blink', label: 'Cursor blink', section: 'terminal', keywords: 'caret' },
  { id: 'terminal-bell', label: 'Terminal bell', section: 'terminal', keywords: 'sound flash beep' },
  { id: 'copy-on-select', label: 'Copy on select', section: 'terminal', keywords: 'clipboard' },
  { id: 'right-click-paste', label: 'Right-click paste', section: 'terminal', keywords: 'clipboard mouse' },
  { id: 'sftp-view-mode', label: 'Default view mode', section: 'sftp', keywords: 'list grid file browser' },
  { id: 'sftp-double-click', label: 'Double-click action', section: 'sftp', keywords: 'open transfer edit file' },
  { id: 'sftp-autocomplete', label: 'Address bar autocomplete', section: 'sftp', keywords: 'path history content' },
  { id: 'sftp-local-directory', label: 'Default local directory', section: 'sftp', keywords: 'folder start path' },
  { id: 'sftp-hidden-files', label: 'Show hidden files by default', section: 'sftp', keywords: 'dotfiles' },
  { id: 'sftp-symlinks', label: 'Follow symbolic links', section: 'sftp', keywords: 'symlink' },
  { id: 'sftp-concurrent', label: 'Concurrent transfers', section: 'sftp', keywords: 'parallel upload download' },
  { id: 'sftp-bandwidth', label: 'Bandwidth limit', section: 'sftp', keywords: 'speed throttle kb' },
  { id: 'sftp-conflicts', label: 'Conflict resolution', section: 'sftp', keywords: 'overwrite skip rename transfer' },
  { id: 'sftp-timestamps', label: 'Preserve file timestamps', section: 'sftp', keywords: 'modified date transfer' },
  { id: 'sql-filter-match', label: 'Default filter match', section: 'sql', keywords: 'table filters and or' },
  { id: 'keepalive', label: 'Keep-alive interval', section: 'connection', keywords: 'ssh ping idle' },
  { id: 'connection-timeout', label: 'Connection timeout', section: 'connection', keywords: 'ssh seconds' },
  { id: 'reconnect-attempts', label: 'Reconnect attempts', section: 'connection', keywords: 'retry ssh' },
  { id: 'reconnect-delay', label: 'Reconnect delay', section: 'connection', keywords: 'retry wait seconds' },
  { id: 'search-scopes', label: 'Search in', section: 'search', keywords: 'global search scopes toggles' },
  { id: 'search-excluded-folders', label: 'Excluded folders', section: 'search', keywords: 'ignore vendor node_modules' },
  { id: 'search-clear-index', label: 'Clear search index', section: 'search', keywords: 'cache reset privacy' }
]

export const SETTINGS_ENTRIES: SettingsEntry[] = [...sectionEntries, ...notableEntries]
