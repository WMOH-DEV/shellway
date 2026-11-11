import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useSQLStore } from '@/stores/sqlStore'
import type { ClosedSQLTab, SQLTab } from '@/types/sql'
import { TabsMenu } from './TabsMenu'
import type { TabActions } from './tabActions'

const CONNECTION = 'c1'

const make = (patch: Partial<SQLTab> & Pick<SQLTab, 'id'>): SQLTab => ({
  type: 'data',
  label: patch.id,
  ...patch
})

const orders = make({ id: 'orders', database: 'shop_db' })
const payments = make({ id: 'payments', database: 'shop_db' })
const users = make({ id: 'users', database: 'auth_db' })
const report = make({ id: 'report', type: 'query', label: 'Query 1' })
const closedSessions: ClosedSQLTab = { tab: make({ id: 'sessions', database: 'auth_db' }), index: 0, closedAt: Date.now() }
const closedCoupons: ClosedSQLTab = { tab: make({ id: 'coupons', database: 'shop_db' }), index: 0, closedAt: Date.now() }

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

function renderMenu(actions = createActions(), onClose = vi.fn(), open = true) {
  render(<TabsMenu connectionId={CONNECTION} actions={actions} open={open} onClose={onClose} />)
  return { actions, onClose, input: screen.queryByRole('combobox') }
}

const optionNames = (): string[] =>
  screen.getAllByRole('option').map((option) => option.querySelector('span.truncate')?.textContent ?? '')

describe('TabsMenu', () => {
  let originalClientHeight: PropertyDescriptor | undefined

  beforeEach(() => {
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 })
    useSQLStore.getState().removeConnection(CONNECTION)
    useSQLStore.getState().setCurrentDatabase(CONNECTION, 'shop_db')
    useSQLStore.getState().restoreTabs(CONNECTION, {
      tabs: [orders, payments, users, report],
      activeTabId: 'payments',
      mru: ['payments', 'report', 'orders', 'users'],
      closedTabs: [closedSessions, closedCoupons]
    })
  })

  afterEach(() => {
    if (originalClientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
  })

  it('renders nothing when closed', () => {
    const { input } = renderMenu(createActions(), vi.fn(), false)
    expect(input).toBeNull()
    expect(screen.queryByText('Go to tab')).toBeNull()
  })

  it('lists the current database tabs in most recently used order', () => {
    renderMenu()
    expect(optionNames()).toEqual(['payments', 'Query 1', 'orders'])
  })

  it('filters rows as the user types', () => {
    renderMenu()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pay' } })
    expect(optionNames()).toEqual(['payments'])
  })

  it('shows an empty message when nothing matches', () => {
    renderMenu()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } })
    expect(screen.getByText('No open tabs match')).toBeInTheDocument()
  })

  it('filters by scope chip', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Queries 1' }))
    expect(optionNames()).toEqual(['Query 1'])
  })

  it('activates the second row with ArrowDown and Enter', () => {
    const { actions, onClose } = renderMenu()
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(actions.activate).toHaveBeenCalledWith('report')
    expect(onClose).toHaveBeenCalled()
  })

  it('closes the highlighted tab on Backspace with an empty query', () => {
    const { actions } = renderMenu()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Backspace' })
    expect(actions.close).toHaveBeenCalledWith('payments')
  })

  it('leaves tabs alone on Backspace while there is text', () => {
    const { actions } = renderMenu()
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'o' } })
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(actions.close).not.toHaveBeenCalled()
  })

  it('calls onClose on Escape', () => {
    const { onClose } = renderMenu()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('reopens a recently closed tab of the current database', () => {
    const { actions, onClose } = renderMenu()
    expect(screen.queryByRole('button', { name: /sessions/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /coupons/ }))
    expect(actions.reopenClosed).toHaveBeenCalledWith(0)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes every unpinned tab except the active one with Close others', () => {
    const { actions } = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Close others' }))
    expect(actions.closeMany).toHaveBeenCalledWith(['orders', 'report'])
  })
})
