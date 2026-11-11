/**
 * Keybinding system — action definitions, scopes, and defaults.
 *
 * Combo format:
 *   "CmdOrCtrl+Shift+S"  → ⌘+Shift+S on Mac, Ctrl+Shift+S on Win/Linux
 *   "Ctrl+F"             → Physical Ctrl on all platforms (for terminal shortcuts)
 *   "F5"                 → Standalone key, no modifiers
 *
 * Modifiers: CmdOrCtrl, Ctrl, Shift, Alt
 * Keys: single char (uppercase), or special names: Enter, Escape, Tab, F1–F12, ArrowUp, etc.
 */

/** Shortcut scope — determines where the shortcut is active */
export type KeybindingScope = 'global' | 'terminal' | 'sql'

/** A single keybinding action definition */
export interface KeybindingAction {
  /** Unique action ID (e.g. 'global:newTerminalTab') */
  id: string
  /** Human-readable label */
  label: string
  /** Scope / group */
  scope: KeybindingScope
  /** Default key combination */
  defaultCombo: string
}

/** All customizable keybinding actions, organized by scope */
export const KEYBINDING_ACTIONS: KeybindingAction[] = [
  // ── Global ──
  { id: 'global:newWindow',       label: 'New Window',             scope: 'global',   defaultCombo: 'CmdOrCtrl+Alt+N' },
  { id: 'global:newTerminalTab',  label: 'New Terminal Tab',       scope: 'global',   defaultCombo: 'CmdOrCtrl+Shift+T' },
  { id: 'global:switchToSFTP',    label: 'Switch to SFTP',         scope: 'global',   defaultCombo: 'CmdOrCtrl+Shift+F' },
  { id: 'global:switchToSQL',     label: 'Switch to SQL',          scope: 'global',   defaultCombo: 'CmdOrCtrl+Shift+D' },
  { id: 'global:toggleSplitView', label: 'Toggle Split View',      scope: 'global',   defaultCombo: 'CmdOrCtrl+Shift+B' },
  { id: 'global:focusTerminal',   label: 'Focus Terminal Pane',    scope: 'global',   defaultCombo: 'CmdOrCtrl+1' },
  { id: 'global:focusSFTP',       label: 'Focus SFTP Pane',        scope: 'global',   defaultCombo: 'CmdOrCtrl+2' },
  { id: 'global:focusOtherPane',  label: 'Switch Pane Focus',      scope: 'global',   defaultCombo: 'Alt+\\' },
  { id: 'global:splitRight',      label: 'Split Right',            scope: 'global',   defaultCombo: 'Ctrl+\\' },
  { id: 'global:splitDown',       label: 'Split Down',             scope: 'global',   defaultCombo: 'CmdOrCtrl+Shift+\\' },
  { id: 'global:closePane',       label: 'Close Pane',             scope: 'global',   defaultCombo: 'Alt+Shift+W' },
  { id: 'global:search',          label: 'Search Everything',      scope: 'global',   defaultCombo: 'CmdOrCtrl+K' },

  // ── Terminal ──
  { id: 'terminal:search',          label: 'Search in Terminal',    scope: 'terminal', defaultCombo: 'Ctrl+F' },
  { id: 'terminal:snippetPalette',  label: 'Snippet Quick Palette', scope: 'terminal', defaultCombo: 'CmdOrCtrl+Shift+S' },

  // ── SQL ──
  { id: 'sql:runQuery',       label: 'Run Query',              scope: 'sql', defaultCombo: 'CmdOrCtrl+Enter' },
  { id: 'sql:applyChanges',   label: 'Apply Staged Changes',   scope: 'sql', defaultCombo: 'CmdOrCtrl+S' },
  { id: 'sql:toggleSidebar',  label: 'Toggle SQL Sidebar',     scope: 'sql', defaultCombo: 'CmdOrCtrl+B' },
  { id: 'sql:newTab',         label: 'New Query Tab',           scope: 'sql', defaultCombo: 'CmdOrCtrl+Shift+N' },
  { id: 'sql:closeTab',       label: 'Close SQL Tab',           scope: 'sql', defaultCombo: 'CmdOrCtrl+W' },
  { id: 'sql:closeOtherTabs', label: 'Close Other SQL Tabs',    scope: 'sql', defaultCombo: 'CmdOrCtrl+Alt+W' },
  { id: 'sql:reopenClosedTab', label: 'Reopen Closed SQL Tab',  scope: 'sql', defaultCombo: 'CmdOrCtrl+Shift+T' },
  { id: 'sql:pinTab',         label: 'Pin / Unpin SQL Tab',     scope: 'sql', defaultCombo: 'CmdOrCtrl+Shift+P' },
  { id: 'sql:tabMenu',        label: 'Go to SQL Tab (search)',  scope: 'sql', defaultCombo: 'CmdOrCtrl+Shift+A' },
  { id: 'sql:recentTabs',     label: 'Recent SQL Tabs Switcher', scope: 'sql', defaultCombo: 'Ctrl+Tab' },
  { id: 'sql:nextTab',        label: 'Next SQL Tab',            scope: 'sql', defaultCombo: 'CmdOrCtrl+Alt+ArrowRight' },
  { id: 'sql:prevTab',        label: 'Previous SQL Tab',        scope: 'sql', defaultCombo: 'CmdOrCtrl+Alt+ArrowLeft' },
  { id: 'sql:goToTab1',     label: 'Go to SQL Tab 1',         scope: 'sql', defaultCombo: 'CmdOrCtrl+1' },
  { id: 'sql:goToTab2',     label: 'Go to SQL Tab 2',         scope: 'sql', defaultCombo: 'CmdOrCtrl+2' },
  { id: 'sql:goToTab3',     label: 'Go to SQL Tab 3',         scope: 'sql', defaultCombo: 'CmdOrCtrl+3' },
  { id: 'sql:goToTab4',     label: 'Go to SQL Tab 4',         scope: 'sql', defaultCombo: 'CmdOrCtrl+4' },
  { id: 'sql:goToTab5',     label: 'Go to SQL Tab 5',         scope: 'sql', defaultCombo: 'CmdOrCtrl+5' },
  { id: 'sql:goToTab6',     label: 'Go to SQL Tab 6',         scope: 'sql', defaultCombo: 'CmdOrCtrl+6' },
  { id: 'sql:goToTab7',     label: 'Go to SQL Tab 7',         scope: 'sql', defaultCombo: 'CmdOrCtrl+7' },
  { id: 'sql:goToTab8',     label: 'Go to SQL Tab 8',         scope: 'sql', defaultCombo: 'CmdOrCtrl+8' },
  { id: 'sql:goToLastTab',    label: 'Go to Last SQL Tab',      scope: 'sql', defaultCombo: 'CmdOrCtrl+9' },
  { id: 'sql:insertRow',      label: 'Insert New Row',          scope: 'sql', defaultCombo: 'CmdOrCtrl+Shift+I' },
  { id: 'sql:duplicateRow',   label: 'Duplicate Selected Row',  scope: 'sql', defaultCombo: 'CmdOrCtrl+D' },
  { id: 'sql:undoChange',     label: 'Undo Last Change',         scope: 'sql', defaultCombo: 'CmdOrCtrl+Z' },
  { id: 'sql:cycleTabType',   label: 'Cycle Tab Type',          scope: 'sql', defaultCombo: 'CmdOrCtrl+.' },
  { id: 'sql:refresh',        label: 'Refresh Data',            scope: 'sql', defaultCombo: 'F5' },
]

/** Scope display labels */
export const SCOPE_LABELS: Record<KeybindingScope, string> = {
  global: 'Global',
  terminal: 'Terminal',
  sql: 'SQL Client',
}

/** Build the default keybindings map from action definitions */
export const DEFAULT_KEYBINDINGS: Record<string, string> = Object.fromEntries(
  KEYBINDING_ACTIONS.map((a) => [a.id, a.defaultCombo])
)
