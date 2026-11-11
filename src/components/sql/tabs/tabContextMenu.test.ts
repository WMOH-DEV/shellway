import { describe, expect, it, vi } from 'vitest'
import type { SQLTab } from '@/types/sql'
import type { TabActions } from './tabActions'
import { buildTabContextMenu, runTabContextAction } from './tabContextMenu'

const tab = (id: string, extra: Partial<SQLTab> = {}): SQLTab => ({ id, type: 'data', label: id, table: id, ...extra })

function fakeActions(): TabActions {
  return {
    activate: vi.fn(),
    close: vi.fn(),
    closeMany: vi.fn(),
    promote: vi.fn(),
    pin: vi.fn(),
    duplicate: vi.fn(),
    move: vi.fn(),
    reopenClosed: vi.fn(),
    sortByName: vi.fn(),
    revealInSidebar: vi.fn(),
    copyName: vi.fn()
  }
}

const tabs = [tab('p', { pinned: true }), tab('a'), tab('b'), tab('c')]

describe('buildTabContextMenu', () => {
  it('disables actions that would do nothing', () => {
    const items = buildTabContextMenu(tabs[3], tabs)
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))
    expect(byId['close-right'].disabled).toBe(true)
    expect(byId['close-others'].disabled).toBe(false)
    expect(byId.pin.label).toBe('Pin')
    expect(buildTabContextMenu(tabs[0], tabs)[0].label).toBe('Unpin')
  })

  it('disables reveal for query tabs', () => {
    const items = buildTabContextMenu({ id: 'q', type: 'query', label: 'Q' }, tabs)
    expect(items.find((i) => i.id === 'reveal')?.disabled).toBe(true)
  })
})

describe('runTabContextAction', () => {
  it('keeps pinned tabs when closing others, to the right or unpinned', () => {
    const actions = fakeActions()
    runTabContextAction('close-others', tabs[1], tabs, actions)
    runTabContextAction('close-right', tabs[1], tabs, actions)
    runTabContextAction('close-unpinned', tabs[1], tabs, actions)
    expect(actions.closeMany).toHaveBeenNthCalledWith(1, ['b', 'c'])
    expect(actions.closeMany).toHaveBeenNthCalledWith(2, ['b', 'c'])
    expect(actions.closeMany).toHaveBeenNthCalledWith(3, ['a', 'b', 'c'])
  })

  it('toggles the pin', () => {
    const actions = fakeActions()
    runTabContextAction('pin', tabs[0], tabs, actions)
    expect(actions.pin).toHaveBeenCalledWith('p', false)
  })
})
