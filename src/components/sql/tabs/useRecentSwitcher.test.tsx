import { act, fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SQLTab } from '@/types/sql'
import { holdModifiers, useRecentSwitcher } from './useRecentSwitcher'

const tab = (id: string): SQLTab => ({ id, type: 'data', label: id, table: id })
const FOUR_TABS = ['a', 'b', 'c', 'd'].map(tab)

function setup(rows: SQLTab[] = FOUR_TABS, enabled = true) {
  const onCommit = vi.fn()
  const hook = renderHook(() => useRecentSwitcher({ enabled, getRows: () => rows, onCommit }))
  return { onCommit, ...hook }
}

const pressCtrlTab = (extra: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, ...extra })
const releaseControl = () => fireEvent.keyUp(window, { key: 'Control', ctrlKey: false })

describe('useRecentSwitcher', () => {
  it('commits the previous tab when Control is released after one Ctrl+Tab', () => {
    const { onCommit, result } = setup()
    pressCtrlTab()
    expect(result.current.open).toBe(true)
    expect(result.current.highlight).toBe(1)
    releaseControl()
    expect(onCommit).toHaveBeenCalledWith('b')
    expect(result.current.open).toBe(false)
  })

  it('moves forward on each extra Tab while Control is held', () => {
    const { onCommit } = setup()
    pressCtrlTab()
    pressCtrlTab()
    releaseControl()
    expect(onCommit).toHaveBeenCalledWith('c')
  })

  it('moves back with Shift', () => {
    const { onCommit, result } = setup()
    pressCtrlTab()
    pressCtrlTab({ shiftKey: true })
    expect(result.current.highlight).toBe(0)
    releaseControl()
    expect(onCommit).toHaveBeenCalledWith('a')
  })

  it('jumps to a row with a digit key', () => {
    const { onCommit } = setup()
    pressCtrlTab()
    fireEvent.keyDown(window, { key: '3', ctrlKey: true })
    expect(onCommit).toHaveBeenCalledWith('d')
  })

  it('cancels with Escape and does not commit on release', () => {
    const { onCommit, result } = setup()
    pressCtrlTab()
    fireEvent.keyDown(window, { key: 'Escape', ctrlKey: true })
    expect(result.current.open).toBe(false)
    releaseControl()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('does not open with a single row', () => {
    const { result } = setup([tab('a')])
    pressCtrlTab()
    expect(result.current.open).toBe(false)
  })

  it('does not open when disabled', () => {
    const { result } = setup(FOUR_TABS, false)
    pressCtrlTab()
    expect(result.current.open).toBe(false)
  })

  it('closes when it becomes disabled', () => {
    const onCommit = vi.fn()
    const { result, rerender } = renderHook(
      ({ enabled }) => useRecentSwitcher({ enabled, getRows: () => FOUR_TABS, onCommit }),
      { initialProps: { enabled: true } }
    )
    pressCtrlTab()
    expect(result.current.open).toBe(true)
    act(() => rerender({ enabled: false }))
    expect(result.current.open).toBe(false)
  })
})

describe('holdModifiers', () => {
  it('lists the modifiers of a combo', () => {
    expect(holdModifiers('Ctrl+Tab')).toEqual(['Control'])
  })

  it('is empty for a combo without modifiers', () => {
    expect(holdModifiers('Tab')).toEqual([])
  })
})
