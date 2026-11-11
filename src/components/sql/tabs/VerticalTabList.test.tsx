import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useSQLStore } from '@/stores/sqlStore'
import type { SQLTab } from '@/types/sql'
import type { TabActions } from './tabActions'
import { VerticalTabList } from './VerticalTabList'

const CONNECTION_ID = 'c1'

function tab(id: string, patch: Partial<SQLTab> = {}): SQLTab {
  return { id, type: 'data', label: id, table: id, database: 'shop_db', ...patch }
}

const tabs: SQLTab[] = [
  tab('orders', { pinned: true }),
  tab('products'),
  tab('invoices', { preview: true }),
  tab('revenue', { type: 'query', table: undefined }),
  tab('users', { database: undefined }),
  tab('sessions', { database: undefined }),
  tab('logins', { database: 'auth_db' })
]

function createActions(): TabActions {
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

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => void entries.delete(key),
    setItem: (key, value) => void entries.set(key, value)
  }
}

function seed(): void {
  const store = useSQLStore.getState()
  store.removeConnection(CONNECTION_ID)
  store.setCurrentDatabase(CONNECTION_ID, 'shop_db')
  store.restoreTabs(CONNECTION_ID, { tabs, activeTabId: 'orders' })
}

describe('VerticalTabList', () => {
  let originalClientHeight: PropertyDescriptor | undefined

  beforeEach(() => {
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 })
    vi.stubGlobal('localStorage', createMemoryStorage())
    seed()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
  })

  it('renders the group headers and the tab count', () => {
    render(<VerticalTabList connectionId={CONNECTION_ID} actions={createActions()} />)
    expect(screen.getByRole('button', { name: /^Pinned/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^shop_db/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^No database/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^auth_db/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: /logins/ })).toBeNull()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('hides the tabs of a group when its header is clicked', () => {
    render(<VerticalTabList connectionId={CONNECTION_ID} actions={createActions()} />)
    expect(screen.getByRole('tab', { name: /products/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^shop_db/ }))
    expect(screen.queryByRole('tab', { name: /products/ })).toBeNull()
    expect(screen.getByRole('tab', { name: /users/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^shop_db/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('narrows the rows while typing in the filter', () => {
    render(<VerticalTabList connectionId={CONNECTION_ID} actions={createActions()} />)
    fireEvent.change(screen.getByLabelText('Filter open tabs'), { target: { value: 'sess' } })
    expect(screen.getByRole('tab', { name: /sessions/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /products/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^shop_db/ })).toBeNull()
  })

  it('activates a tab when it is clicked', () => {
    const actions = createActions()
    render(<VerticalTabList connectionId={CONNECTION_ID} actions={actions} />)
    fireEvent.click(screen.getByRole('tab', { name: /products/ }))
    expect(actions.activate).toHaveBeenCalledWith('products')
  })

  it('regroups by kind when Kind is selected and remembers the choice', () => {
    render(<VerticalTabList connectionId={CONNECTION_ID} actions={createActions()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Kind' }))
    expect(screen.getByRole('button', { name: /^Tables/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Queries/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^shop_db/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Kind' })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('sql-vertical-tabs-group')).toBe('kind')
  })

  it('closes a tab from its close button without activating it', () => {
    const actions = createActions()
    render(<VerticalTabList connectionId={CONNECTION_ID} actions={actions} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Close tab' })[0])
    expect(actions.close).toHaveBeenCalledWith('products')
    expect(actions.activate).not.toHaveBeenCalled()
  })

  it('moves focus to the next tab row with ArrowDown, skipping group rows', () => {
    render(<VerticalTabList connectionId={CONNECTION_ID} actions={createActions()} />)
    const pinned = screen.getByRole('tab', { name: /orders/ })
    pinned.focus()
    fireEvent.keyDown(pinned, { key: 'ArrowDown' })
    expect(screen.getByRole('tab', { name: /products/ })).toHaveFocus()
  })
})
