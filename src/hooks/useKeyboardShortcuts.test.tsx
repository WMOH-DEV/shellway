import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/stores/uiStore'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

function Harness() {
  useKeyboardShortcuts()
  return <textarea data-testid="field" />
}

function pressSearchKey(target: Element | Window) {
  const isMac = navigator.platform.includes('Mac')
  fireEvent.keyDown(target, { key: 'k', metaKey: isMac, ctrlKey: !isMac })
}

beforeEach(() => {
  ;(window as unknown as { novadeck: unknown }).novadeck = { window: {} }
  useUIStore.setState({ searchOpen: false, searchInitial: '' })
})

describe('useKeyboardShortcuts search binding', () => {
  it('toggles the palette from anywhere in the window', () => {
    render(<Harness />)

    pressSearchKey(window)
    expect(useUIStore.getState().searchOpen).toBe(true)

    pressSearchKey(window)
    expect(useUIStore.getState().searchOpen).toBe(false)
  })

  it('wins over an element that would otherwise swallow the key', () => {
    const { getByTestId } = render(<Harness />)
    const field = getByTestId('field')
    const swallowed = vi.fn((e: Event) => e.stopPropagation())
    field.addEventListener('keydown', swallowed)

    pressSearchKey(field)

    expect(useUIStore.getState().searchOpen).toBe(true)
    expect(swallowed).not.toHaveBeenCalled()
  })

  it('ignores key repeat so holding the shortcut does not flicker', () => {
    render(<Harness />)
    const isMac = navigator.platform.includes('Mac')

    fireEvent.keyDown(window, { key: 'k', metaKey: isMac, ctrlKey: !isMac, repeat: true })

    expect(useUIStore.getState().searchOpen).toBe(false)
  })
})
