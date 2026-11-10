import { describe, expect, it } from 'vitest'
import type { SQLTab } from '@/types/sql'
import {
  CLOSED_TABS_CAP,
  activateTab,
  closeTabs,
  enforceLimit,
  insertTab,
  moveTab,
  mruTabs,
  openPreview,
  promoteTab,
  reopenClosed,
  setPinned,
  sortByName,
  tabKind,
  type TabsState
} from './tabModel'

const table = (id: string, extra: Partial<SQLTab> = {}): SQLTab => ({
  id,
  type: 'data',
  label: id,
  table: id,
  database: 'shop_db',
  ...extra
})

const state = (tabs: SQLTab[], activeTabId: string | null = tabs[0]?.id ?? null): TabsState => ({
  tabs,
  activeTabId,
  mru: activeTabId ? [activeTabId] : [],
  closed: []
})

const ids = (s: TabsState): string[] => s.tabs.map((t) => t.id)
const never = (): boolean => false

describe('tabKind', () => {
  it('derives the kind from type and view mode', () => {
    expect(tabKind({ id: 'q', type: 'query', label: 'Q' })).toBe('query')
    expect(tabKind(table('orders'))).toBe('table')
    expect(tabKind(table('orders', { viewMode: 'structure' }))).toBe('structure')
    expect(tabKind({ id: 's', type: 'structure', label: 's' })).toBe('structure')
  })
})

describe('insertTab', () => {
  it('opens next to the active tab and activates it', () => {
    const s = insertTab(state([table('a'), table('b')], 'a'), table('c'), 'next', 5)
    expect(ids(s)).toEqual(['a', 'c', 'b'])
    expect(s.activeTabId).toBe('c')
    expect(s.mru[0]).toBe('c')
    expect(s.tabs[1].createdAt).toBe(5)
    expect(s.tabs[1].lastActiveAt).toBe(5)
  })

  it('opens at the end when asked', () => {
    const s = insertTab(state([table('a'), table('b')], 'a'), table('c'), 'end', 5)
    expect(ids(s)).toEqual(['a', 'b', 'c'])
  })

  it('never lands a new tab inside the pinned group', () => {
    const s = insertTab(
      state([table('p', { pinned: true }), table('q', { pinned: true }), table('a')], 'p'),
      table('c'),
      'next',
      5
    )
    expect(ids(s)).toEqual(['p', 'q', 'c', 'a'])
  })
})

describe('openPreview', () => {
  it('replaces the previous preview in place', () => {
    const s0 = state([table('a'), table('old', { preview: true }), table('b')], 'a')
    const s = openPreview(s0, table('new'), 'next', 9, never)
    expect(ids(s)).toEqual(['a', 'new', 'b'])
    expect(s.tabs[1].preview).toBe(true)
    expect(s.activeTabId).toBe('new')
    expect(s.mru).not.toContain('old')
  })

  it('inserts a preview when none exists', () => {
    const s = openPreview(state([table('a')]), table('new'), 'end', 9, never)
    expect(ids(s)).toEqual(['a', 'new'])
    expect(s.tabs[1].preview).toBe(true)
  })

  it('activates an already open tab for the same table', () => {
    const s0 = state([table('a'), table('orders', { id: 'o1' })], 'a')
    const s = openPreview(s0, table('orders', { id: 'o2' }), 'next', 9, never)
    expect(ids(s)).toEqual(['a', 'o1'])
    expect(s.activeTabId).toBe('o1')
  })

  it('openPreview keeps a preview tab that has edits', () => {
    const s0 = state([table('old', { preview: true })], 'old')
    const s = openPreview(s0, table('new'), 'end', 9, (t) => t.id === 'old')
    expect(ids(s)).toEqual(['old', 'new'])
    expect(s.tabs[0].preview).toBe(false)
    expect(s.tabs[1].preview).toBe(true)
  })

  it('keeps a dirty preview tab too', () => {
    const s0 = state([table('old', { preview: true, isDirty: true })], 'old')
    const s = openPreview(s0, table('new'), 'end', 9, never)
    expect(ids(s)).toEqual(['old', 'new'])
  })
})

describe('promoteTab', () => {
  it('turns a preview into a normal tab', () => {
    const s = promoteTab(state([table('a', { preview: true })]), 'a')
    expect(s.tabs[0].preview).toBe(false)
  })

  it('returns the same state when nothing changes', () => {
    const s0 = state([table('a')])
    expect(promoteTab(s0, 'a')).toBe(s0)
  })
})

describe('activateTab', () => {
  it('moves the tab to the front of the MRU list and stamps it', () => {
    const s0 = { ...state([table('a'), table('b')], 'a'), mru: ['a', 'b'] }
    const s = activateTab(s0, 'b', 42)
    expect(s.activeTabId).toBe('b')
    expect(s.mru).toEqual(['b', 'a'])
    expect(s.tabs[1].lastActiveAt).toBe(42)
  })

  it('ignores unknown ids', () => {
    const s0 = state([table('a')])
    expect(activateTab(s0, 'zzz', 1)).toBe(s0)
  })
})

describe('closeTabs', () => {
  it('pushes closed tabs with their index, newest first', () => {
    const s = closeTabs(state([table('a'), table('b'), table('c')], 'a'), ['b'], 7)
    expect(ids(s)).toEqual(['a', 'c'])
    expect(s.closed[0]).toEqual({ tab: table('b'), index: 1, closedAt: 7 })
  })

  it('selects the neighbour in the same position when the active tab closes', () => {
    const s = closeTabs(state([table('a'), table('b'), table('c')], 'b'), ['b'], 7)
    expect(s.activeTabId).toBe('c')
    const last = closeTabs(state([table('a'), table('b')], 'b'), ['b'], 7)
    expect(last.activeTabId).toBe('a')
    const none = closeTabs(state([table('a')], 'a'), ['a'], 7)
    expect(none.activeTabId).toBeNull()
  })

  it('caps the closed stack', () => {
    let s = state(Array.from({ length: CLOSED_TABS_CAP + 5 }, (_, i) => table(`t${i}`)))
    s = closeTabs(s, s.tabs.map((t) => t.id), 1)
    expect(s.closed).toHaveLength(CLOSED_TABS_CAP)
  })

  it('drops closed ids from the MRU list', () => {
    const s0 = { ...state([table('a'), table('b')], 'a'), mru: ['a', 'b'] }
    expect(closeTabs(s0, ['b'], 1).mru).toEqual(['a'])
  })
})

describe('reopenClosed', () => {
  it('restores the last closed tab at its old index as a normal tab', () => {
    const s0 = closeTabs(state([table('a'), table('b', { preview: true }), table('c')], 'a'), ['b'], 1)
    const s = reopenClosed(s0, 2)
    expect(ids(s)).toEqual(['a', 'b', 'c'])
    expect(s.tabs[1].preview).toBe(false)
    expect(s.activeTabId).toBe('b')
    expect(s.closed).toHaveLength(0)
  })

  it('clamps the index when fewer tabs remain', () => {
    const s0 = closeTabs(state([table('a'), table('b'), table('c')], 'a'), ['c'], 1)
    const s1 = closeTabs(s0, ['b'], 2)
    const s = reopenClosed({ ...s1, closed: s1.closed.slice(1) }, 3)
    expect(ids(s)).toEqual(['a', 'c'])
  })

  it('reopenClosed focuses an open duplicate', () => {
    const s0 = closeTabs(state([table('a'), table('orders', { id: 'o1' })], 'a'), ['o1'], 1)
    const s1 = insertTab(s0, table('orders', { id: 'o2' }), 'end', 2)
    const s = reopenClosed(activateTab(s1, 'a', 3), 4)
    expect(ids(s)).toEqual(['a', 'o2'])
    expect(s.activeTabId).toBe('o2')
    expect(s.closed).toHaveLength(0)
  })

  it('does nothing with an empty stack', () => {
    const s0 = state([table('a')])
    expect(reopenClosed(s0, 1)).toBe(s0)
  })
})

describe('setPinned', () => {
  it('moves a pinned tab to the end of the pinned group', () => {
    const s = setPinned(state([table('p', { pinned: true }), table('a'), table('b')]), 'b', true)
    expect(ids(s)).toEqual(['p', 'b', 'a'])
    expect(s.tabs[1].pinned).toBe(true)
  })

  it('moves an unpinned tab to the start of the unpinned group', () => {
    const s = setPinned(
      state([table('p', { pinned: true }), table('q', { pinned: true }), table('a')]),
      'p',
      false
    )
    expect(ids(s)).toEqual(['q', 'p', 'a'])
    expect(s.tabs[1].pinned).toBe(false)
  })

  it('pinning a preview tab promotes it', () => {
    const s = setPinned(state([table('a', { preview: true })]), 'a', true)
    expect(s.tabs[0].preview).toBe(false)
  })
})

describe('moveTab', () => {
  it('moves within the unpinned group', () => {
    const s = moveTab(state([table('a'), table('b'), table('c')]), 'c', 0)
    expect(ids(s)).toEqual(['c', 'a', 'b'])
  })

  it('never crosses into the pinned group', () => {
    const s = moveTab(state([table('p', { pinned: true }), table('a'), table('b')]), 'b', 0)
    expect(ids(s)).toEqual(['p', 'b', 'a'])
  })

  it('keeps a pinned tab inside the pinned group', () => {
    const s = moveTab(state([table('p', { pinned: true }), table('q', { pinned: true }), table('a')]), 'p', 5)
    expect(ids(s)).toEqual(['q', 'p', 'a'])
  })
})

describe('sortByName', () => {
  it('sorts A–Z inside each group', () => {
    const s = sortByName(
      state([table('zeta', { pinned: true }), table('Alpha', { pinned: true }), table('orders'), table('Customers')])
    )
    expect(ids(s)).toEqual(['Alpha', 'zeta', 'Customers', 'orders'])
  })
})

describe('enforceLimit', () => {
  const aged = (id: string, lastActiveAt: number, extra: Partial<SQLTab> = {}): SQLTab =>
    table(id, { lastActiveAt, ...extra })

  it('closes the least recently used tabs first', () => {
    const s0 = state([aged('a', 3), aged('b', 1), aged('c', 2), aged('d', 4)], 'd')
    const { state: s, overLimit } = enforceLimit(s0, 2, never, 10)
    expect(ids(s)).toEqual(['a', 'd'])
    expect(overLimit).toBe(false)
    expect(s.closed.map((c) => c.tab.id)).toEqual(['c', 'b'])
  })

  it('skips pinned, dirty, protected and active tabs', () => {
    const s0 = state(
      [aged('p', 1, { pinned: true }), aged('d', 1, { isDirty: true }), aged('x', 1), aged('act', 1), aged('ok', 2)],
      'act'
    )
    const { state: s } = enforceLimit(s0, 4, (t) => t.id === 'x', 10)
    expect(ids(s)).toEqual(['p', 'd', 'x', 'act'])
  })

  it('falls back to createdAt when a tab was never active', () => {
    const s0 = state([table('a', { createdAt: 5 }), table('b', { createdAt: 1 }), table('c')], 'c')
    expect(ids(enforceLimit(s0, 2, never, 10).state)).toEqual(['a', 'c'])
  })

  it('enforceLimit goes over when nothing is evictable', () => {
    const s0 = state([table('a', { pinned: true }), table('b', { isDirty: true }), table('c')], 'c')
    const { state: s, overLimit } = enforceLimit(s0, 1, never, 10)
    expect(ids(s)).toEqual(['a', 'b', 'c'])
    expect(overLimit).toBe(true)
  })

  it('treats 0 as no limit', () => {
    const s0 = state([table('a'), table('b')])
    expect(enforceLimit(s0, 0, never, 1)).toEqual({ state: s0, overLimit: false })
  })
})

describe('mruTabs', () => {
  it('lists tabs most recent first, then never-activated ones in order', () => {
    const s0 = { ...state([table('a'), table('b'), table('c')], 'b'), mru: ['b', 'a'] }
    expect(mruTabs(s0).map((t) => t.id)).toEqual(['b', 'a', 'c'])
  })
})
