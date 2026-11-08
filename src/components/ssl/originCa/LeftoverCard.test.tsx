import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import type { SwitchLeftover } from '@/types/ssl'
import { makeHost, makeOrigin, NOW } from '@/utils/ssl/testReport'
import { leftoverOf, switchApplied, switchBlock, switchFailed, switchReport } from '@/utils/ssl/switchWizard/testFixtures'
import { HostnameDetail } from '../HostnameDetail'
import { LeftoverCard } from './LeftoverCard'

interface BackendOptions {
  leftovers?: (SwitchLeftover | null)[]
  removeCode?: number
  undone?: ReturnType<typeof switchApplied>
}

function setupBackend({ leftovers = [leftoverOf()], removeCode = 0, undone = switchApplied({ output: 'Restored the site file' }) }: BackendOptions = {}) {
  let listener: (runId: string, chunk: string) => void = () => undefined
  const queue = [...leftovers]
  const backend = {
    leftover: vi.fn(async () => ({ success: true, data: queue.length > 1 ? queue.shift() : queue[0] })),
    remove: vi.fn(async (_c: string, _lineage: string, runId: string) => {
      listener(runId, 'Deleted all files relating to the certificate\n')
      return { success: true, data: { code: removeCode, output: '' } }
    }),
    undo: vi.fn(async (_c: string, _s: string, _name: string, _revoke: boolean, runId: string) => {
      listener(runId, 'Restoring the site file\n')
      return { success: true, data: undone }
    })
  }
  mockNovadeck({
    'ssl.originLeftover': backend.leftover,
    'ssl.removeLineage': backend.remove,
    'ssl.originUndo': backend.undo,
    'ssl.onOutput': vi.fn((callback: (runId: string, chunk: string) => void) => {
      listener = callback
      return vi.fn()
    })
  })
  return backend
}

function renderCard(enabled = true) {
  const onChanged = vi.fn()
  render(<LeftoverCard connectionId="conn-1" sessionId="session-1" name="app.example.com" enabled={enabled} onChanged={onChanged} />)
  return { onChanged }
}

describe('LeftoverCard', () => {
  it('stays hidden when there is no leftover', async () => {
    const backend = setupBackend({ leftovers: [null] })
    renderCard()
    await waitFor(() => expect(backend.leftover).toHaveBeenCalledWith('conn-1', 'app.example.com'))
    expect(screen.queryByRole('region', { name: 'After the switch' })).not.toBeInTheDocument()
  })

  it('does not look for a leftover on a hostname that is not on Origin CA', () => {
    const backend = setupBackend()
    renderCard(false)
    expect(backend.leftover).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'After the switch' })).not.toBeInTheDocument()
  })

  it('explains the leftover and offers both actions', async () => {
    setupBackend()
    renderCard()
    const card = await screen.findByRole('region', { name: 'After the switch' })
    expect(card).toHaveTextContent('certbot still renews a certificate this hostname no longer uses')
    expect(screen.getByText('sudo -n certbot delete --cert-name app.example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })

  it('disables removal with the reason when another hostname still uses the lineage', async () => {
    setupBackend({ leftovers: [leftoverOf({ lineageShared: true })] })
    renderCard()
    expect(await screen.findByRole('button', { name: 'Remove' })).toBeDisabled()
    expect(screen.getByText('Another hostname still uses this certificate.')).toBeInTheDocument()
  })

  it('hides Undo when the switch can no longer be undone', async () => {
    setupBackend({ leftovers: [leftoverOf({ undoable: false })] })
    renderCard()
    await screen.findByRole('button', { name: 'Remove' })
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('removes the lineage once, streams the output, re-checks and drops the actions', async () => {
    const u = userEvent.setup()
    const backend = setupBackend({ leftovers: [leftoverOf(), null] })
    const { onChanged } = renderCard()
    await u.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Deleted all files relating to the certificate')).toBeInTheDocument()
    expect(backend.remove).toHaveBeenCalledTimes(1)
    expect(backend.remove).toHaveBeenCalledWith('conn-1', 'app.example.com', expect.any(String))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('certbot certificate removed')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument())
  })

  it('drops the removed lineage even when the backend keeps reporting it', async () => {
    const u = userEvent.setup()
    const backend = setupBackend({ leftovers: [leftoverOf()] })
    const { onChanged } = renderCard()
    await u.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('certbot certificate removed')).toBeInTheDocument()
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('drops the lineage after a successful undo even when the backend keeps reporting it', async () => {
    const u = userEvent.setup()
    setupBackend({ leftovers: [leftoverOf()] })
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Switch undone')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('looks again after the parent re-check when the removal failed', async () => {
    const u = userEvent.setup()
    const order: string[] = []
    const backend = setupBackend({ removeCode: 1 })
    backend.leftover.mockImplementation(async () => {
      order.push('reload')
      return { success: true, data: leftoverOf() }
    })
    render(<LeftoverCard connectionId="conn-1" sessionId="session-1" name="app.example.com" enabled onChanged={async () => { order.push('changed') }} />)
    await u.click(await screen.findByRole('button', { name: 'Remove' }))
    await screen.findByText('The removal failed (exit 1)')
    await waitFor(() => expect(order).toEqual(['reload', 'changed', 'reload']))
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled()
  })

  it('shows a failed removal', async () => {
    const u = userEvent.setup()
    setupBackend({ removeCode: 1 })
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('The removal failed (exit 1)')).toBeInTheDocument()
  })

  it('undoes the switch for the hostname, streams the output and re-checks', async () => {
    const u = userEvent.setup()
    const backend = setupBackend({ leftovers: [leftoverOf(), null] })
    const { onChanged } = renderCard()
    await u.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Restoring the site file')).toBeInTheDocument()
    expect(backend.undo).toHaveBeenCalledWith('conn-1', 'session-1', 'app.example.com', true, expect.any(String))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Switch undone')).toBeInTheDocument()
  })

  it('asks to revoke the certificate in Cloudflare by default and leaves it when unticked', async () => {
    const backend = setupBackend()
    const u = userEvent.setup()
    renderCard()
    const box = await screen.findByRole('checkbox', { name: 'Also revoke the certificate in Cloudflare' })
    expect(box).toBeChecked()
    await u.click(box)
    await u.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(backend.undo).toHaveBeenCalledWith('conn-1', 'session-1', 'app.example.com', false, expect.any(String)))
  })

  it('shows a failed undo', async () => {
    const u = userEvent.setup()
    setupBackend({ undone: switchFailed() })
    renderCard()
    await u.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Undoing the switch failed')).toBeInTheDocument()
  })
})

describe('HostnameDetail after a switch', () => {
  const originHost = makeHost({
    name: 'app.example.com',
    blockId: switchBlock.id,
    lineage: null,
    origin: makeOrigin({ kind: 'cloudflare-origin', names: ['app.example.com'], notAfter: NOW + 3000 * 86_400 })
  })

  function renderDetail(host = originHost) {
    render(
      <HostnameDetail
        connectionId="conn-1"
        sessionId="session-1"
        host={host}
        report={switchReport({ hostnames: [host] })}
        now={NOW}
        loading={false}
        error={null}
        run={{ lineage: null, running: null, output: '', outcome: null, start: vi.fn() }}
        onBack={vi.fn()}
        onAddHttps={vi.fn()}
        onSwitchOrigin={vi.fn()}
        onSetZoneStrict={vi.fn()}
        onRefresh={vi.fn(async () => undefined)}
      />
    )
  }

  it('shows the leftover card for a hostname on Origin CA', async () => {
    setupBackend()
    renderDetail()
    expect(await screen.findByRole('region', { name: 'After the switch' })).toBeInTheDocument()
  })

  it('does not ask about a leftover for a Let\'s Encrypt hostname', () => {
    const backend = setupBackend()
    renderDetail(makeHost({ name: 'app.example.com', blockId: switchBlock.id }))
    expect(backend.leftover).not.toHaveBeenCalled()
  })
})
