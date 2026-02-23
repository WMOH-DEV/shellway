import { create } from 'zustand'
import { DEFAULT_KEYBINDINGS } from '@/types/keybindings'
import { matchesKeyCombo } from '@/utils/keybindings'

interface KeybindingState {
  /** Current keybinding map: actionId → combo string */
  bindings: Record<string, string>

  /** Load keybindings from persisted settings */
  loadBindings: () => Promise<void>

  /** Update a single keybinding (persists to settings) */
  updateBinding: (actionId: string, combo: string) => Promise<void>

  /** Reset a single keybinding to its default */
  resetBinding: (actionId: string) => Promise<void>

  /** Reset all keybindings to defaults */
  resetAll: () => Promise<void>
}

export const useKeybindingStore = create<KeybindingState>((set) => ({
  bindings: { ...DEFAULT_KEYBINDINGS },

  loadBindings: async () => {
    const settings = await window.novadeck.settings.getAll()
    const saved = (settings as Record<string, unknown>).keybindings as Record<string, string> | undefined
    set({ bindings: { ...DEFAULT_KEYBINDINGS, ...saved } })
  },

  updateBinding: async (actionId, combo) => {
    const bindings = { ...useKeybindingStore.getState().bindings, [actionId]: combo }
    set({ bindings })
    await window.novadeck.settings.update({ keybindings: bindings } as never).catch((err: unknown) => {
      console.warn('Failed to persist keybinding update:', err)
    })
  },

  resetBinding: async (actionId) => {
    const defaultCombo = DEFAULT_KEYBINDINGS[actionId]
    if (!defaultCombo) return
    const bindings = { ...useKeybindingStore.getState().bindings, [actionId]: defaultCombo }
    set({ bindings })
    await window.novadeck.settings.update({ keybindings: bindings } as never).catch((err: unknown) => {
      console.warn('Failed to persist keybinding reset:', err)
    })
  },

  resetAll: async () => {
    const bindings = { ...DEFAULT_KEYBINDINGS }
    await window.novadeck.settings.update({ keybindings: bindings } as never)
    set({ bindings })
  },
}))

/**
 * Get the current combo for an action (non-reactive, for event handlers).
 * Always returns the latest value from the store.
 */
export function getBinding(actionId: string): string {
  return useKeybindingStore.getState().bindings[actionId] ?? DEFAULT_KEYBINDINGS[actionId] ?? ''
}

/**
 * Check if a KeyboardEvent matches a keybinding action.
 * Non-reactive — safe to use inside xterm handlers, global event listeners, etc.
 */
export function matchesBinding(e: KeyboardEvent, actionId: string): boolean {
  const combo = getBinding(actionId)
  if (!combo) return false
  return matchesKeyCombo(e, combo)
}
