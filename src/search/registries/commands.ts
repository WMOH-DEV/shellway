import { getBinding } from '@/stores/keybindingStore'
import { useUIStore } from '@/stores/uiStore'
import { KEYBINDING_ACTIONS, SCOPE_LABELS } from '@/types/keybindings'
import { comboToKeyboardEventInit, formatCombo } from '@/utils/keybindings'
import { sendIntent, type SqlIntentAction } from '../intentStore'
import type { SearchContext } from '../types'
import { SETTINGS_SECTIONS } from './settingsEntries'

const SEARCH_ACTION_ID = 'global:search'

export interface CommandEntry {
  id: string
  title: string
  subtitle: string
  keywords: string
  contextual: boolean
  run: () => void
}

export function runKeybinding(actionId: string): void {
  const combo = getBinding(actionId)
  if (!combo) return
  const isMac = navigator.platform?.includes('Mac') ?? false
  const target: EventTarget = document.activeElement ?? window
  target.dispatchEvent(new KeyboardEvent('keydown', comboToKeyboardEventInit(combo, isMac)))
}

function keybindingCommands(): CommandEntry[] {
  return KEYBINDING_ACTIONS.filter((action) => action.id !== SEARCH_ACTION_ID).map((action) => ({
    id: `key:${action.id}`,
    title: action.label,
    subtitle: `${SCOPE_LABELS[action.scope]} · ${formatCombo(getBinding(action.id))}`,
    keywords: 'shortcut keybinding',
    contextual: false,
    run: () => runKeybinding(action.id)
  }))
}

function toggleTheme(): void {
  const next = useUIStore.getState().resolvedTheme === 'dark' ? 'light' : 'dark'
  useUIStore.getState().setTheme(next)
  window.novadeck.settings.update({ theme: next }).catch(() => {})
}

function appCommand(id: string, title: string, run: () => void, keywords = ''): CommandEntry {
  return { id: `app:${id}`, title, subtitle: 'Command', keywords, contextual: false, run }
}

function appCommands(): CommandEntry[] {
  const ui = () => useUIStore.getState()
  return [
    appCommand('open-settings', 'Open Settings', () => ui().openSettings('general'), 'preferences options'),
    ...SETTINGS_SECTIONS.map((section) => appCommand(`settings-${section.id}`, `Settings › ${section.label}`, () => ui().openSettings(section.id), 'preferences')),
    appCommand('toggle-theme', 'Toggle theme', toggleTheme, 'dark light mode appearance'),
    appCommand('new-session', 'New session', () => ui().requestSessionForm(), 'add server connection ssh'),
    appCommand('connect-database', 'Connect to database', () => ui().requestDatabaseConnect(), 'sql mysql postgres'),
    appCommand('toggle-sidebar', 'Toggle sidebar', () => ui().toggleSidebar(), 'panel sessions'),
    appCommand('host-keys', 'Host keys', () => ui().toggleHostKeyManager(), 'known hosts fingerprint'),
    appCommand('client-keys', 'Client keys', () => ui().toggleClientKeyManager(), 'ssh private key manager')
  ]
}

function sqlCommand(sessionId: string, action: SqlIntentAction, title: string): CommandEntry {
  return {
    id: `sql:${action}`,
    title,
    subtitle: 'SQL · current database',
    keywords: 'database sql',
    contextual: true,
    run: () => sendIntent(sessionId, { kind: 'sql-action', action })
  }
}

function sqlCommands(context: SearchContext): CommandEntry[] {
  const { activeSessionId, activeDatabase } = context
  if (!activeSessionId || !activeDatabase) return []
  return [
    sqlCommand(activeSessionId, 'export', `Export database ${activeDatabase}…`),
    sqlCommand(activeSessionId, 'import', `Import into ${activeDatabase}…`),
    sqlCommand(activeSessionId, 'backup', `Back up database ${activeDatabase}…`),
    sqlCommand(activeSessionId, 'restore', `Restore database ${activeDatabase}…`),
    sqlCommand(activeSessionId, 'refresh', 'Refresh schema'),
    sqlCommand(activeSessionId, 'create-table', 'Create table'),
    sqlCommand(activeSessionId, 'new-query', 'New query tab')
  ]
}

export function buildCommandEntries(context: SearchContext): CommandEntry[] {
  return [...sqlCommands(context), ...appCommands(), ...keybindingCommands()]
}
