import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import { useSessionStore } from '@/stores/sessionStore'
import type { PortForwardRule, Session } from '@/types/session'
import type { PortForwardEntry, PortForwardSpec } from '@/types/portForward'
import { PortForwardingView } from './PortForwardingView'

const TAKEN_PORT = 9999

const rule = (id: string, sourcePort: number, extra: Partial<PortForwardRule> = {}): PortForwardRule => ({
  id,
  type: 'local',
  name: `Tunnel ${id}`,
  sourceHost: '127.0.0.1',
  sourcePort,
  destinationHost: '127.0.0.1',
  destinationPort: 3306,
  autoStart: false,
  enabled: true,
  ...extra
})

function backend(initial: PortForwardRule[]) {
  let saved = { id: 's1', name: 'Test server', portForwardings: initial } as unknown as Session
  const running = new Map<string, PortForwardEntry>()
  const add = vi.fn(async (_connectionId: string, spec: PortForwardSpec) => {
    const failed = spec.sourcePort === TAKEN_PORT
    const entry: PortForwardEntry = {
      ...spec,
      connectionId: 'c1',
      status: failed ? 'error' : 'active',
      error: failed ? `Port ${TAKEN_PORT} is already in use on this computer` : undefined,
      openConnections: 0,
      bytes: 0
    }
    running.set(spec.id, entry)
    return { success: !failed, data: entry, error: entry.error }
  })
  const remove = vi.fn(async (_connectionId: string, id: string) => running.delete(id))
  const update = vi.fn(async (_id: string, updates: Partial<Session>) => {
    saved = { ...saved, ...updates }
  })
  mockNovadeck({
    'portforward.add': add,
    'portforward.remove': remove,
    'portforward.list': vi.fn(async () => [...running.values()]),
    'sessions.getById': vi.fn(async () => saved),
    'sessions.update': update
  })
  useSessionStore.setState({ sessions: [saved] })
  return { add, remove, update, running, saved: () => saved.portForwardings ?? [] }
}

function renderView(connected = true) {
  return render(<PortForwardingView connectionId="c1" sessionId="s1" connected={connected} />)
}

const row = (name: string) => screen.getByText(name).closest('div.rounded-lg') as HTMLElement

beforeEach(() => {
  useSessionStore.setState({ sessions: [] })
})

describe('PortForwardingView', () => {
  it('really starts a tunnel and shows it as active', async () => {
    const api = backend([rule('a', 7777, { autoStart: true })])
    renderView()

    await userEvent.click(await screen.findByRole('button', { name: 'Start Tunnel a' }))

    expect(api.add).toHaveBeenCalledWith('c1', {
      id: 'a',
      type: 'local',
      name: 'Tunnel a',
      sourceHost: '127.0.0.1',
      sourcePort: 7777,
      destinationHost: '127.0.0.1',
      destinationPort: 3306
    })
    expect(await within(row('Tunnel a')).findByText('Active')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop Tunnel a' })).toBeInTheDocument()
  })

  it('shows why a tunnel could not start', async () => {
    backend([rule('a', TAKEN_PORT)])
    renderView()

    await userEvent.click(await screen.findByRole('button', { name: 'Start Tunnel a' }))

    expect(await within(row('Tunnel a')).findByText('Failed')).toBeInTheDocument()
    expect(within(row('Tunnel a')).getByText(`Port ${TAKEN_PORT} is already in use on this computer`)).toBeInTheDocument()
  })

  it('saves a new rule on the session so it survives a restart', async () => {
    const api = backend([])
    renderView()

    await userEvent.click(screen.getByRole('button', { name: 'New rule' }))
    await userEvent.type(screen.getByLabelText('Name (optional)'), 'db tunnel')
    await userEvent.type(screen.getByLabelText('Listen port'), '7777')
    await userEvent.type(screen.getByLabelText('Destination port'), '3306')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.saved()).toHaveLength(1))
    expect(api.saved()[0]).toMatchObject({ name: 'db tunnel', sourcePort: 7777, destinationPort: 3306, destinationHost: '127.0.0.1' })
    expect(await screen.findByText('db tunnel')).toBeInTheDocument()
  })

  it('explains what is wrong before saving', async () => {
    const api = backend([rule('a', 7777)])
    renderView()

    await userEvent.click(screen.getByRole('button', { name: 'New rule' }))
    await userEvent.type(screen.getByLabelText('Listen port'), '7777')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(screen.getByText('"Tunnel a" already uses port 7777')).toBeInTheDocument()
    expect(screen.getByText('Enter a port')).toBeInTheDocument()
    expect(api.update).not.toHaveBeenCalled()
  })

  it('edits a running rule and restarts it on the new port', async () => {
    const api = backend([rule('a', 7777)])
    renderView()
    await userEvent.click(await screen.findByRole('button', { name: 'Start Tunnel a' }))
    await within(row('Tunnel a')).findByText('Active')

    await userEvent.click(screen.getByRole('button', { name: 'Edit Tunnel a' }))
    const port = screen.getByLabelText('Listen port')
    await userEvent.clear(port)
    await userEvent.type(port, '7778')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.add).toHaveBeenLastCalledWith('c1', expect.objectContaining({ id: 'a', sourcePort: 7778 })))
    expect(api.saved()[0].sourcePort).toBe(7778)
  })

  it('deletes the selected rules after confirming and stops the running ones', async () => {
    const api = backend([rule('a', 7777), rule('b', 7778), rule('c', 7779)])
    renderView()
    await userEvent.click(await screen.findByRole('button', { name: 'Start Tunnel a' }))
    await within(row('Tunnel a')).findByText('Active')

    await userEvent.click(screen.getByLabelText('Select Tunnel a'))
    await userEvent.click(screen.getByLabelText('Select Tunnel b'))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(screen.getByText('Delete 2 rules?').closest('div')!.parentElement!).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.saved().map((saved) => saved.id)).toEqual(['c']))
    expect(api.remove).toHaveBeenCalledWith('c1', 'a')
    expect(api.running.size).toBe(0)
  })

  it('starts and stops every rule at once', async () => {
    const api = backend([rule('a', 7777), rule('b', 7778)])
    renderView()

    await userEvent.click(await screen.findByRole('button', { name: 'Start all' }))
    await waitFor(() => expect(api.running.size).toBe(2))
    expect(await screen.findAllByText('Active')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Stop all' }))
    await waitFor(() => expect(api.running.size).toBe(0))
    expect(await screen.findAllByText('Stopped')).toHaveLength(2)
  })

  it('cannot start tunnels while the server is disconnected', async () => {
    backend([rule('a', 7777)])
    renderView(false)

    expect(await screen.findByText('Connect to this server to start tunnels.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start Tunnel a' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start all' })).toBeDisabled()
  })

  it('shows a running tunnel as waiting while the connection is down', async () => {
    const api = backend([rule('a', 7777)])
    const view = renderView()
    await userEvent.click(await screen.findByRole('button', { name: 'Start Tunnel a' }))
    await within(row('Tunnel a')).findByText('Active')

    view.rerender(<PortForwardingView connectionId="c1" sessionId="s1" connected={false} />)

    expect(await within(row('Tunnel a')).findByText('Waiting for connection')).toBeInTheDocument()
    expect(api.running.size).toBe(1)
  })

  it('stops the old tunnel when a rule is edited while the server is offline', async () => {
    const api = backend([rule('a', 7777)])
    const view = renderView()
    await userEvent.click(await screen.findByRole('button', { name: 'Start Tunnel a' }))
    await within(row('Tunnel a')).findByText('Active')
    view.rerender(<PortForwardingView connectionId="c1" sessionId="s1" connected={false} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit Tunnel a' }))
    const port = screen.getByLabelText('Listen port')
    await userEvent.clear(port)
    await userEvent.type(port, '7778')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('c1', 'a'))
    expect(api.add).toHaveBeenCalledTimes(1)
    expect(await within(row('Tunnel a')).findByText('Stopped')).toBeInTheDocument()
  })

  it('refreshes when the app reports a change for this connection', async () => {
    const api = backend([rule('a', 7777)])
    let notify: (connectionId: string) => void = () => {}
    window.novadeck.portforward.onChanged = vi.fn((callback: (connectionId: string) => void) => {
      notify = callback
      return () => {}
    })
    renderView()
    await screen.findByText('Stopped')

    await api.add('c1', rule('a', 7777))
    act(() => notify('c1'))

    expect(await within(row('Tunnel a')).findByText('Active')).toBeInTheDocument()
  })

  it('copies the address apps should connect to', async () => {
    backend([rule('a', 7777, { sourceHost: '0.0.0.0' })])
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderView()

    await userEvent.click(await screen.findByRole('button', { name: 'Copy address' }))

    expect(writeText).toHaveBeenCalledWith('127.0.0.1:7777')
  })
})
