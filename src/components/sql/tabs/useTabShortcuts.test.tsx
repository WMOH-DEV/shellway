import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/stores/uiStore'
import type { TabActions } from './tabActions'
import { useTabShortcuts } from './useTabShortcuts'

function Harness({ onOpenMenu }: { onOpenMenu: () => void }) {
  useTabShortcuts({ enabled: true, connectionId: 'c1', actions: {} as TabActions, onOpenMenu })
  return null
}

function pressTabMenu() {
  const isMac = navigator.platform.includes('Mac')
  fireEvent.keyDown(window, { key: 'A', shiftKey: true, metaKey: isMac, ctrlKey: !isMac })
}

describe('useTabShortcuts while the search palette is open', () => {
  beforeEach(() => useUIStore.setState({ searchOpen: false }))

  it('runs SQL tab shortcuts normally', () => {
    const onOpenMenu = vi.fn()
    render(<Harness onOpenMenu={onOpenMenu} />)
    pressTabMenu()
    expect(onOpenMenu).toHaveBeenCalledTimes(1)
  })

  it('ignores them while the palette is open', () => {
    const onOpenMenu = vi.fn()
    useUIStore.setState({ searchOpen: true })
    render(<Harness onOpenMenu={onOpenMenu} />)
    pressTabMenu()
    expect(onOpenMenu).not.toHaveBeenCalled()
  })
})
