import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUIStore } from '@/stores/uiStore'
import type { ConnectionTab, Session } from '@/types/session'
import type { RemoteSearchEvent, TextMatch } from '@/types/search'
import { TextSearchView } from './TextSearchView'

const sendIntent = vi.hoisted(() => vi.fn())

vi.mock('@/search/intentStore', () => ({ sendIntent }))

const ROOT = '/var/www/shop'
const HIT_PATH = `${ROOT}/app/Listeners/SendRefundEmail.php`

function makeTab(status: ConnectionTab['status']): ConnectionTab {
  return { id: 'conn-1', sessionId: 'sess-1', sessionName: 'Main', status, activeSubTab: 'server' }
}

function makeMatch(line: number, path = HIT_PATH): TextMatch {
  return { path, line, text: 'handle(OrderRefunded $event)', ranges: [[7, 20]] }
}

interface Harness {
  emit: (event: RemoteSearchEvent) => void
  findText: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  preview: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  onTextChange: ReturnType<typeof vi.fn>
  unmount: () => void
}

function setup(status: ConnectionTab['status'] = 'connected', initialText = ''): Harness {
  let handler: (event: RemoteSearchEvent) => void = () => {}
  const findText = vi.fn(async () => ({ searchId: 's1', command: 'rg' }))
  const cancel = vi.fn(async () => undefined)
  const preview = vi.fn(async () => [
    { line: 13, text: '{' },
    { line: 14, text: 'handle($event)' }
  ])
  mockNovadeck({
    'search.findText': findText,
    'search.cancel': cancel,
    'search.preview': preview,
    'search.onEvent': vi.fn((cb: (event: RemoteSearchEvent) => void) => {
      handler = cb
      return vi.fn()
    })
  })
  useConnectionStore.setState({ tabs: [makeTab(status)], activeTabId: 'conn-1' })
  useSessionStore.setState({ sessions: [{ id: 'sess-1', name: 'Main', defaultDirectory: ROOT } as Session] })
  const onClose = vi.fn()
  const onTextChange = vi.fn()
  const { unmount } = render(<TextSearchView initialText={initialText} onTextChange={onTextChange} onClose={onClose} />)
  return {
    unmount,
    emit: (event) => act(() => handler(event)),
    findText,
    cancel,
    preview,
    onClose,
    onTextChange
  }
}

async function typeQuery(text: string) {
  await userEvent.type(screen.getByLabelText('Text to find'), text)
}

async function startedSearch(harness: Harness, text = 'OrderRefunded') {
  await typeQuery(text)
  await waitFor(() => expect(harness.findText).toHaveBeenCalledTimes(1), { timeout: 2000 })
}

describe('TextSearchView', () => {
  beforeEach(() => {
    sendIntent.mockReset()
    useConnectionStore.setState({ tabs: [], activeTabId: null })
    useSessionStore.setState({ sessions: [] })
  })

  it('waits for typing to pause before searching and sends the default folder and excludes', async () => {
    const harness = setup()
    await typeQuery('Order')
    expect(harness.findText).not.toHaveBeenCalled()
    await waitFor(() => expect(harness.findText).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(harness.findText).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      root: ROOT,
      text: 'Order',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      includes: [],
      excludes: ['vendor', 'node_modules', 'storage', '.git']
    })
    expect(harness.onTextChange).toHaveBeenLastCalledWith('Order')
  })

  it('does not search for a single character', async () => {
    const harness = setup()
    await typeQuery('O')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(harness.findText).not.toHaveBeenCalled()
  })

  it('passes the option toggles and include globs', async () => {
    const harness = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Match case' }))
    await userEvent.click(screen.getByRole('button', { name: 'Regular expression' }))
    expect(screen.getByRole('button', { name: 'Regular expression' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.type(screen.getByLabelText('Files to include'), '*.php, *.blade.php')
    await typeQuery('Order')
    await waitFor(() => expect(harness.findText).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(harness.findText).toHaveBeenCalledWith(
      expect.objectContaining({ caseSensitive: true, regex: true, includes: ['*.php', '*.blade.php'] })
    )
  })

  it('cancels the running search when the text changes', async () => {
    const harness = setup()
    await startedSearch(harness)
    expect(harness.cancel).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Text to find'), 's')
    await waitFor(() => expect(harness.cancel).toHaveBeenCalledWith('s1'))
  })

  it('stops the running search from the Stop button', async () => {
    const harness = setup()
    await startedSearch(harness)
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(harness.cancel).toHaveBeenCalledWith('s1')
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('cancels the running search on unmount', async () => {
    const harness = setup()
    await startedSearch(harness)
    harness.unmount()
    expect(harness.cancel).toHaveBeenCalledWith('s1')
  })

  it('never calls the search IPC for a disconnected server and offers to connect', async () => {
    const harness = setup('disconnected')
    await typeQuery('OrderRefunded')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(harness.findText).not.toHaveBeenCalled()
    expect(harness.preview).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Connect and search' }))
    expect(useUIStore.getState().connectSessionId).toBe('sess-1')
  })

  it('shows counts and the truncation notice', async () => {
    const harness = setup()
    await startedSearch(harness)
    harness.emit({ searchId: 's1', kind: 'text', matches: [makeMatch(5), makeMatch(14)] })
    expect(await screen.findByText('2 matches in 1 file')).toBeInTheDocument()
    harness.emit({ searchId: 's1', kind: 'done', truncated: true, timedOut: false })
    expect(await screen.findByText(/stopped at 2,000 matches/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('shows a timeout notice', async () => {
    const harness = setup()
    await startedSearch(harness)
    harness.emit({ searchId: 's1', kind: 'done', truncated: false, timedOut: true })
    expect(await screen.findByText(/timed out after 20 s/)).toBeInTheDocument()
  })

  it('shows the error from the server', async () => {
    const harness = setup()
    await startedSearch(harness)
    harness.emit({ searchId: 's1', kind: 'done', truncated: false, timedOut: false, error: 'regex parse error' })
    expect(await screen.findByText(/regex parse error/)).toBeInTheDocument()
  })

  it('ignores events from another search', async () => {
    const harness = setup()
    await startedSearch(harness)
    harness.emit({ searchId: 'other', kind: 'text', matches: [makeMatch(5)] })
    expect(screen.queryByText('1 match in 1 file')).not.toBeInTheDocument()
  })

  it('shows the preview for the first hit', async () => {
    const harness = setup()
    await startedSearch(harness)
    harness.emit({ searchId: 's1', kind: 'text', matches: [makeMatch(14)] })
    await waitFor(() => expect(harness.preview).toHaveBeenCalledWith('conn-1', HIT_PATH, 14, 5), { timeout: 2000 })
    expect(await screen.findByText('handle($event)')).toBeInTheDocument()
  })

  it('opens the selected hit at its line with Enter', async () => {
    const harness = setup()
    await startedSearch(harness)
    harness.emit({ searchId: 's1', kind: 'text', matches: [makeMatch(14)] })
    await screen.findByText('1 match in 1 file')
    await userEvent.type(screen.getByLabelText('Text to find'), '{Enter}')
    expect(sendIntent).toHaveBeenCalledWith('sess-1', { kind: 'sftp-open', path: HIT_PATH, line: 14 })
    expect(harness.onClose).toHaveBeenCalledTimes(1)
  })

  it('reveals the selected hit in SFTP with Cmd+Enter', async () => {
    const harness = setup()
    await startedSearch(harness)
    harness.emit({ searchId: 's1', kind: 'text', matches: [makeMatch(14)] })
    await screen.findByText('1 match in 1 file')
    await userEvent.type(screen.getByLabelText('Text to find'), '{Meta>}{Enter}{/Meta}')
    expect(sendIntent).toHaveBeenCalledWith('sess-1', { kind: 'sftp-reveal', path: HIT_PATH })
    expect(harness.onClose).toHaveBeenCalledTimes(1)
  })

  it('moves between hits with the arrow keys', async () => {
    const harness = setup()
    await startedSearch(harness)
    harness.emit({ searchId: 's1', kind: 'text', matches: [makeMatch(5), makeMatch(14)] })
    await screen.findByText('2 matches in 1 file')
    await userEvent.type(screen.getByLabelText('Text to find'), '{ArrowDown}{Enter}')
    expect(sendIntent).toHaveBeenCalledWith('sess-1', { kind: 'sftp-open', path: HIT_PATH, line: 14 })
  })

  it('starts the search right away on Enter before any results exist', async () => {
    const harness = setup()
    await typeQuery('Order')
    await userEvent.type(screen.getByLabelText('Text to find'), '{Enter}')
    expect(harness.findText).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', async () => {
    const harness = setup()
    await userEvent.type(screen.getByLabelText('Text to find'), '{Escape}')
    expect(harness.onClose).toHaveBeenCalledTimes(1)
  })

  it('starts from the initial text', async () => {
    const harness = setup('connected', 'OrderRefunded')
    await waitFor(() => expect(harness.findText).toHaveBeenCalledTimes(1), { timeout: 2000 })
    expect(screen.getByLabelText('Text to find')).toHaveValue('OrderRefunded')
  })
})
