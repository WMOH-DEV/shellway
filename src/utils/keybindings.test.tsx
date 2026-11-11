import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYBINDINGS } from '@/types/keybindings'
import { comboToKeyboardEventInit, matchesKeyCombo } from './keybindings'

const isMac = navigator.platform?.includes('Mac') ?? false

describe('comboToKeyboardEventInit', () => {
  it.each(Object.entries(DEFAULT_KEYBINDINGS))('%s round-trips through matchesKeyCombo', (_id, combo) => {
    const event = new KeyboardEvent('keydown', comboToKeyboardEventInit(combo, isMac))
    expect(matchesKeyCombo(event, combo)).toBe(true)
  })

  it('maps CmdOrCtrl to meta on mac and ctrl elsewhere', () => {
    expect(comboToKeyboardEventInit('CmdOrCtrl+K', true)).toMatchObject({ key: 'k', metaKey: true, ctrlKey: false })
    expect(comboToKeyboardEventInit('CmdOrCtrl+K', false)).toMatchObject({ key: 'k', metaKey: false, ctrlKey: true })
  })

  it('keeps the physical ctrl modifier separate', () => {
    expect(comboToKeyboardEventInit('Ctrl+F', true)).toMatchObject({ ctrlKey: true, metaKey: false })
  })

  it('sets shift and alt', () => {
    expect(comboToKeyboardEventInit('CmdOrCtrl+Alt+Shift+N', true)).toMatchObject({ altKey: true, shiftKey: true })
  })
})
