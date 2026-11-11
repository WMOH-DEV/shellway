import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/stores/uiStore'
import type { SearchAction, SearchProvider, SearchResult } from '@/search/types'

const runs = {
  open: vi.fn(),
  openNew: vi.fn(),
  copy: vi.fn(),
  openQuery: vi.fn()
}

function row(id: string, providerId: SearchResult['providerId'], title: string, icon: SearchResult['icon']): SearchResult {
  return { id, providerId, title, subtitle: `${providerId} subtitle`, icon, scoreHints: {}, payload: null }
}

const tableResults = [
  row('table:s1:shop:orders', 'tables', 'orders', 'table'),
  row('table:s1:shop:orders_items', 'tables', 'orders_items', 'table'),
  row('table:s1:shop:orders_notes', 'tables', 'orders_notes', 'table'),
  row('table:s1:shop:orders_logs', 'tables', 'orders_logs', 'table'),
  row('table:s1:shop:orders_refs', 'tables', 'orders_refs', 'table')
]
const queryResults = [row('query:s1:1', 'queries', 'Orders per day', 'query')]

function localProvider(id: SearchProvider['id'], scopes: SearchProvider['scopes'], results: SearchResult[]): SearchProvider {
  return {
    id,
    kind: 'local',
    scopes,
    async *search(query) {
      const text = query.text.toLowerCase()
      yield text ? results.filter((r) => r.title.toLowerCase().includes(text)) : []
    },
    actions(result): SearchAction[] {
      if (id === 'tables') {
        return [
          { id: 'open', label: 'Open', role: 'primary', run: () => runs.open(result.id) },
          { id: 'open-new', label: 'Open in new tab', role: 'secondary', run: () => runs.openNew(result.id) },
          { id: 'copy', label: 'Copy name', role: 'copy', run: () => runs.copy(result.id) }
        ]
      }
      return [{ id: 'open-query', label: 'Open query', role: 'primary', run: () => runs.openQuery(result.id) }]
    }
  }
}

vi.mock('@/search/providers', () => ({
  createProviders: () => [localProvider('tables', ['tables'], tableResults), localProvider('queries', ['queries'], queryResults)],
  enabledProviders: (providers: SearchProvider[]) => providers
}))

vi.mock('./TextSearchView', () => ({
  TextSearchView: ({ initialText }: { initialText: string }) => <div data-testid="text-view">{initialText}</div>
}))

import { SearchPalette } from './SearchPalette'

function input(): HTMLInputElement {
  return screen.getByRole('combobox', { name: 'Search everything' }) as HTMLInputElement
}

async function typeAndSettle(text: string) {
  fireEvent.change(input(), { target: { value: text } })
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
}

beforeEach(() => {
  useUIStore.setState({ searchOpen: true, searchInitial: '' })
})

describe('SearchPalette', () => {
  it('renders nothing while closed', () => {
    useUIStore.setState({ searchOpen: false })
    render(<SearchPalette />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the prefix list and no results for an empty query', () => {
    render(<SearchPalette />)
    expect(screen.getByRole('dialog', { name: 'Search everything' })).toBeInTheDocument()
    expect(screen.getByText(/Start with a prefix/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /text in files/ })).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('inserts a prefix when its hint is clicked', () => {
    render(<SearchPalette />)
    fireEvent.click(screen.getByRole('button', { name: /tables/ }))
    expect(input().value).toBe('#')
  })

  it('groups results with a best match first and a +N overflow per group', async () => {
    render(<SearchPalette />)
    await typeAndSettle('orders')

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('orders')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Best match')).toBeInTheDocument()
    const list = within(screen.getByRole('listbox'))
    expect(list.getByText('Tables')).toBeInTheDocument()
    expect(list.getByText('Saved queries')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+1' })).toBeInTheDocument()
  })

  it('moves the selection with the arrow keys and jumps groups with tab', async () => {
    render(<SearchPalette />)
    await typeAndSettle('orders')
    const options = () => screen.getAllByRole('option')

    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(input(), { key: 'Tab' })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'Tab' })
    expect(options()[options().length - 1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'Tab', shiftKey: true })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
  })

  it('runs the primary action on enter, closes, and runs it after the palette is gone', async () => {
    render(<SearchPalette />)
    await typeAndSettle('orders')

    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(useUIStore.getState().searchOpen).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(runs.open).toHaveBeenCalledWith('table:s1:shop:orders'))
  })

  it('runs the secondary action on cmd+enter', async () => {
    render(<SearchPalette />)
    await typeAndSettle('orders')

    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true })

    await waitFor(() => expect(runs.openNew).toHaveBeenCalledWith('table:s1:shop:orders'))
    expect(runs.open).not.toHaveBeenCalled()
  })

  it('runs the copy action on cmd+c only when no text is selected', async () => {
    render(<SearchPalette />)
    await typeAndSettle('orders')

    input().setSelectionRange(0, 3)
    fireEvent.keyDown(input(), { key: 'c', metaKey: true })
    expect(useUIStore.getState().searchOpen).toBe(true)

    input().setSelectionRange(2, 2)
    fireEvent.keyDown(input(), { key: 'c', metaKey: true })
    await waitFor(() => expect(runs.copy).toHaveBeenCalledWith('table:s1:shop:orders'))
  })

  it('closes on escape', () => {
    render(<SearchPalette />)
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(useUIStore.getState().searchOpen).toBe(false)
  })

  it('switches the chip to the group scope when +N is clicked', async () => {
    render(<SearchPalette />)
    await typeAndSettle('orders')

    fireEvent.click(screen.getByRole('button', { name: '+1' }))

    expect(screen.getByRole('button', { name: /^Tables/ })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(5))
  })

  it('shows the preview actions for the selected row and runs one on click', async () => {
    render(<SearchPalette />)
    await typeAndSettle('orders')

    const copy = screen.getByRole('button', { name: /Copy name/ })
    fireEvent.click(copy)

    await waitFor(() => expect(runs.copy).toHaveBeenCalledWith('table:s1:shop:orders'))
  })

  it('hands a leading question mark to the text in files view without the prefix', async () => {
    render(<SearchPalette />)
    fireEvent.change(input(), { target: { value: '?OrderRefunded' } })

    expect(await screen.findByTestId('text-view')).toHaveTextContent('OrderRefunded')
    expect(screen.getByRole('dialog', { name: 'Search text in files' })).toBeInTheDocument()
  })

  it('leaves escape to the text in files view', async () => {
    render(<SearchPalette />)
    fireEvent.change(input(), { target: { value: '?x' } })
    const view = await screen.findByTestId('text-view')

    fireEvent.keyDown(within(screen.getByRole('dialog')).getByTestId('text-view'), { key: 'Escape' })

    expect(view).toBeInTheDocument()
    expect(useUIStore.getState().searchOpen).toBe(true)
  })

  it('shows a no results message', async () => {
    render(<SearchPalette />)
    fireEvent.change(input(), { target: { value: 'zzzz' } })
    expect(await screen.findByText('No results for "zzzz"')).toBeInTheDocument()
  })
})
