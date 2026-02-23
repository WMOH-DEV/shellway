/**
 * Keybinding utilities — matching, recording, and display formatting.
 *
 * Combo format: "CmdOrCtrl+Shift+S", "Ctrl+F", "F5"
 * CmdOrCtrl = ⌘ on Mac, Ctrl on Win/Linux
 * Ctrl = Physical Ctrl key on all platforms
 */

const _isMac = navigator.platform?.includes('Mac') ?? false

/** Parse a combo string into modifiers set + key */
function parseCombo(combo: string): { modifiers: Set<string>; key: string } {
  // Use lastIndexOf to handle '+' as the key itself (e.g. "Ctrl++")
  const lastPlus = combo.lastIndexOf('+')
  let key: string
  let modPart: string

  if (lastPlus <= 0) {
    // No modifier separator, or combo starts with '+' — entire string is the key
    key = combo.toLowerCase()
    modPart = ''
  } else {
    key = combo.slice(lastPlus + 1).toLowerCase() || '+'
    modPart = combo.slice(0, lastPlus)
  }

  const modifiers = modPart
    ? new Set(modPart.split('+').map((m) => m.toLowerCase()))
    : new Set<string>()
  return { modifiers, key }
}

/**
 * Check if a KeyboardEvent matches a combo string.
 *
 * Strict matching — ensures no unwanted modifiers are pressed.
 */
export function matchesKeyCombo(e: KeyboardEvent, combo: string): boolean {
  const { modifiers, key } = parseCombo(combo)

  const hasCmdOrCtrl = modifiers.has('cmdorctrl')
  const hasCtrl = modifiers.has('ctrl')
  const hasShift = modifiers.has('shift')
  const hasAlt = modifiers.has('alt')

  // Expected modifier state
  const expectMeta = _isMac && hasCmdOrCtrl
  const expectCtrl = hasCtrl || (!_isMac && hasCmdOrCtrl)

  // Strict check — only the specified modifiers should be active
  if (e.metaKey !== expectMeta) return false
  if (e.ctrlKey !== expectCtrl) return false
  if (e.shiftKey !== hasShift) return false
  if (e.altKey !== hasAlt) return false

  // Compare key (case-insensitive)
  return e.key.toLowerCase() === key
}

/**
 * Convert a KeyboardEvent into a combo string.
 * Returns null for bare modifier presses (Shift, Ctrl, etc.).
 */
export function eventToCombo(e: KeyboardEvent): string | null {
  // Ignore bare modifier presses
  if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return null

  const parts: string[] = []

  // CmdOrCtrl: Meta on Mac, Ctrl on Win/Linux
  const hasPlatformMod = _isMac ? e.metaKey : e.ctrlKey
  // Physical Ctrl on Mac (distinct from Cmd)
  const hasPhysicalCtrlOnMac = _isMac && e.ctrlKey

  if (hasPlatformMod) parts.push('CmdOrCtrl')
  if (hasPhysicalCtrlOnMac) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')

  // Normalize key name
  let keyName = e.key
  if (keyName === '+') {
    keyName = 'Plus'
  } else if (keyName.length === 1) {
    keyName = keyName.toUpperCase()
  }
  // Normalize common key names to title case
  if (keyName === 'enter') keyName = 'Enter'
  if (keyName === 'escape') keyName = 'Escape'
  if (keyName === 'backspace') keyName = 'Backspace'
  if (keyName === 'delete') keyName = 'Delete'
  if (keyName === 'tab') keyName = 'Tab'
  if (keyName === ' ') keyName = 'Space'

  parts.push(keyName)
  return parts.join('+')
}

/**
 * Format a combo string for display (platform-aware).
 *
 * Mac:  CmdOrCtrl+Shift+S → ⌘⇧S
 * Win:  CmdOrCtrl+Shift+S → Ctrl+Shift+S
 */
export function formatCombo(combo: string): string {
  if (_isMac) return formatComboMac(combo)
  return formatComboWin(combo)
}

/** Mac-style formatting with symbols */
function formatComboMac(combo: string): string {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  const symbols = modifiers.map((mod) => {
    switch (mod.toLowerCase()) {
      case 'cmdorctrl': return '⌘'
      case 'ctrl':      return '⌃'
      case 'shift':     return '⇧'
      case 'alt':       return '⌥'
      default:          return mod
    }
  })

  const displayKey = formatKeyName(key)
  return symbols.join('') + displayKey
}

/** Windows/Linux-style formatting with words */
function formatComboWin(combo: string): string {
  const parts = combo.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1)

  const labels = modifiers.map((mod) => {
    switch (mod.toLowerCase()) {
      case 'cmdorctrl': return 'Ctrl'
      case 'ctrl':      return 'Ctrl'
      case 'shift':     return 'Shift'
      case 'alt':       return 'Alt'
      default:          return mod
    }
  })

  const displayKey = formatKeyName(key)
  return [...labels, displayKey].join('+')
}

/** Normalize key names for display */
function formatKeyName(key: string): string {
  // Single char — uppercase
  if (key.length === 1) return key.toUpperCase()

  // Special keys — display names
  const map: Record<string, string> = {
    enter: '↵',
    escape: 'Esc',
    backspace: '⌫',
    delete: 'Del',
    tab: 'Tab',
    space: 'Space',
    plus: '+',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
  }
  return map[key.toLowerCase()] ?? key
}
