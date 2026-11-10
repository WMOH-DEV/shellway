import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSQLStore } from '@/stores/sqlStore'
import { useSqlTabSettingsStore } from '@/stores/sqlTabSettingsStore'
import type { SQLTab } from '@/types/sql'
import type { TabActions } from './tabActions'
import { TabStrip } from './TabStrip'

function makeTab(overrides: Partial<SQLTab>): SQLTab {
  return { id: 't1', type: 'data', label: 'orders', table: 'orders', database: 'shop_db', ...overrides }
}

function makeActions(): TabActions {
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

function seed(tabs: SQLTab[], activeTabId: string | null = tabs[0]?.id ?? null): void {
  useSQLStore.getState().restoreTabs('c1', { tabs, activeTabId })
}

function renderStrip(actions = makeActions(), handlers: { onOpenMenu?: () => void } = {}) {
  const { unmount } = render(
    <TabStrip
      connectionId="c1"
      actions={actions}
      layout="single"
      onNewQuery={vi.fn()}
      onOpenMenu={handlers.onOpenMenu ?? vi.fn()}
    />
  )
  return { actions, unmount }
}

function tabElement(label: string): HTMLElement {
  return screen.getByRole('tab', { name: new RegExp(label) })
}

beforeEach(() => {
  useSQLStore.getState().removeConnection('c1')
  useSqlTabSettingsStore.setState({
    sqlColorByKind: true,
    sqlShowDatabaseName: true,
    sqlCloseOnMiddleClick: true,
    sqlTabLimit: 15
  })
})

describe('TabStrip rendering', () => {
  it('renders a tab per entry and marks the active one selected', () => {
    seed([makeTab({ id: 't1' }), makeTab({ id: 't2', label: 'users', table: 'users' })], 't2')
    renderStrip()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('italicises preview tabs, marks dirty tabs and hides close on pinned tabs', () => {
    seed([
      makeTab({ id: 't1', label: 'orders', preview: true }),
      makeTab({ id: 't2', label: 'users', table: 'users', isDirty: true }),
      makeTab({ id: 't3', label: 'invoices', table: 'invoices', pinned: true })
    ])
    renderStrip()

    expect(screen.getByText('orders')).toHaveClass('italic')
    expect(screen.getByText('users')).not.toHaveClass('italic')
    expect(within(tabElement('users')).getByLabelText('Unsaved')).toBeInTheDocument()
    expect(within(tabElement('invoices')).queryByLabelText('Close tab')).toBeNull()
    expect(within(tabElement('orders')).getByLabelText('Close tab')).toBeInTheDocument()
  })

  it('shows database names only when tabs span two databases', () => {
    seed([makeTab({ id: 't1' }), makeTab({ id: 't2', label: 'users', table: 'users', database: 'auth_db' })])
    renderStrip()

    expect(screen.getByText('shop_db')).toBeInTheDocument()
    expect(screen.getByText('auth_db')).toBeInTheDocument()
  })

  it('hides database names when the setting is off or only one database is open', () => {
    seed([makeTab({ id: 't1' }), makeTab({ id: 't2', label: 'users', table: 'users', database: 'auth_db' })])
    useSqlTabSettingsStore.setState({ sqlShowDatabaseName: false })
    renderStrip()

    expect(screen.queryByText('shop_db')).toBeNull()
    expect(screen.queryByText('auth_db')).toBeNull()
  })

  it('hides database names when all tabs share one database', () => {
    seed([makeTab({ id: 't1' }), makeTab({ id: 't2', label: 'users', table: 'users' })])
    renderStrip()

    expect(screen.queryByText('shop_db')).toBeNull()
  })

  it('renders kind bars only when colour by kind is on', () => {
    seed([makeTab({ id: 't1' })])
    const { unmount } = renderStrip()
    expect(document.querySelectorAll('[data-kind-bar]')).toHaveLength(1)
    unmount()

    useSqlTabSettingsStore.setState({ sqlColorByKind: false })
    renderStrip()
    expect(document.querySelectorAll('[data-kind-bar]')).toHaveLength(0)
  })
})

describe('TabStrip interaction', () => {
  it('moves focus with ArrowRight, activates on Enter and closes on Delete', async () => {
    const user = userEvent.setup()
    seed([makeTab({ id: 't1' }), makeTab({ id: 't2', label: 'users', table: 'users' })])
    const { actions } = renderStrip()

    tabElement('orders').focus()
    await user.keyboard('{ArrowRight}')
    expect(tabElement('users')).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(actions.activate).toHaveBeenCalledWith('t2')

    await user.keyboard('{Delete}')
    expect(actions.close).toHaveBeenCalledWith('t2')
  })

  it('does not close a pinned tab with Delete', async () => {
    const user = userEvent.setup()
    seed([makeTab({ id: 't1', pinned: true })])
    const { actions } = renderStrip()

    tabElement('orders').focus()
    await user.keyboard('{Delete}')
    expect(actions.close).not.toHaveBeenCalled()
  })

  it('closes on middle mouse down only when the setting is on', () => {
    seed([makeTab({ id: 't1' })])
    const { actions } = renderStrip()

    fireEvent.mouseDown(tabElement('orders'), { button: 1 })
    expect(actions.close).toHaveBeenCalledWith('t1')
  })

  it('ignores middle mouse down when the setting is off', () => {
    useSqlTabSettingsStore.setState({ sqlCloseOnMiddleClick: false })
    seed([makeTab({ id: 't1' })])
    const { actions } = renderStrip()

    fireEvent.mouseDown(tabElement('orders'), { button: 1 })
    expect(actions.close).not.toHaveBeenCalled()
  })

  it('opens the tab menu from the tab count button', async () => {
    const user = userEvent.setup()
    const onOpenMenu = vi.fn()
    seed([makeTab({ id: 't1' }), makeTab({ id: 't2', label: 'users', table: 'users' })])
    renderStrip(makeActions(), { onOpenMenu })

    await user.click(screen.getByRole('button', { name: 'Show all tabs' }))
    expect(onOpenMenu).toHaveBeenCalledOnce()
    expect(screen.getByText('2 tabs')).toBeInTheDocument()
  })

  it('shows the over-limit notice only when the tab limit is exceeded', () => {
    seed([makeTab({ id: 't1' })])
    const { unmount } = renderStrip()
    expect(screen.queryByText(/-tab limit/)).toBeNull()
    unmount()

    useSQLStore.setState((s) => ({
      connections: { ...s.connections, c1: { ...s.connections.c1, tabsOverLimit: true } }
    }))
    renderStrip()
    expect(screen.getByText('Over the 15-tab limit')).toBeInTheDocument()
  })
})
