import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useHttpsIntentStore } from '@/stores/httpsIntentStore'
import { mockNovadeck } from '@/test/novadeck'
import type { HostnameStatus, SslReport } from '@/types/ssl'
import { readinessRow } from '@/utils/ssl/addHttps/testFixtures'
import { makeBlock, makeHost, makeOrigin, makeReport, NOW } from '@/utils/ssl/testReport'
import { HostnameDetail } from '../HostnameDetail'
import { HostnamesScreen } from '../HostnamesScreen'
import { SslView } from '../SslView'
import { NoHttpsChip } from './NoHttpsChip'

const plainBlock = makeBlock({ id: 'plain.conf:1', file: '/etc/nginx/sites-enabled/plain.conf', names: ['plain.example.com'], root: '/var/www/plain/public', tls: false })
const secureBlock = makeBlock({ id: 'secure.conf:1', names: ['secure.example.com'], root: '/var/www/secure/public', tls: true })

const bare: HostnameStatus = makeHost({
  name: 'plain.example.com',
  blockId: 'plain.conf:1',
  lineage: null,
  verdict: 'not-encrypted',
  reason: 'The server does not serve a certificate',
  origin: makeOrigin({ kind: 'none', names: [] })
})
const secured = makeHost({ name: 'secure.example.com', blockId: 'secure.conf:1' })

const report = (): SslReport => makeReport({ blocks: [plainBlock, secureBlock], hostnames: [bare, secured] })

beforeEach(() => {
  useHttpsIntentStore.setState({ pending: {} })
})

describe('Add HTTPS from the hostnames list', () => {
  function renderList() {
    const handlers = { onOpen: vi.fn(), onAddHttps: vi.fn(), onOpenSettings: vi.fn() }
    render(<HostnamesScreen report={report()} serverName="Test server" now={NOW} loading={false} error={null} onRefresh={vi.fn()} {...handlers} />)
    return handlers
  }

  it('starts an empty wizard from the header button', async () => {
    const { onAddHttps } = renderList()
    await userEvent.click(screen.getByRole('button', { name: 'Add HTTPS' }))
    expect(onAddHttps).toHaveBeenCalledWith()
  })

  it('opens the wizard for a row without a server certificate, without opening the detail', async () => {
    const { onAddHttps, onOpen } = renderList()
    await userEvent.click(screen.getByRole('button', { name: 'Add HTTPS to plain.example.com' }))
    expect(onAddHttps).toHaveBeenCalledWith('plain.conf:1')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('offers the action only on rows without a server certificate', () => {
    renderList()
    expect(screen.queryByRole('button', { name: 'Add HTTPS to secure.example.com' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Add HTTPS to / })).toHaveLength(1)
  })
})

describe('Add HTTPS from the hostname detail', () => {
  it('replaces the nothing-to-renew text with an Add HTTPS button', async () => {
    const onAddHttps = vi.fn()
    const sslReport = report()
    render(
      <HostnameDetail
        host={bare}
        report={sslReport}
        now={NOW}
        loading={false}
        error={null}
        run={{ lineage: null, running: null, output: '', outcome: null, start: vi.fn() }}
        onBack={vi.fn()}
        onAddHttps={onAddHttps}
        onRefresh={vi.fn()}
      />
    )
    expect(screen.queryByText(/nothing to renew/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add HTTPS' }))
    expect(onAddHttps).toHaveBeenCalledWith('plain.conf:1')
  })
})

describe('Deploy site chip', () => {
  const site = { connectionId: 'conn-1', path: '/var/www/plain', healthUrl: 'https://plain.example.com/up' }

  function withReport(data: SslReport | null) {
    mockNovadeck({ 'ssl.lastReport': vi.fn(async () => ({ success: true, data })) })
  }

  it('shows when the site matches a block without TLS and hands the block to the SSL tab', async () => {
    withReport(report())
    render(<NoHttpsChip {...site} />)
    await userEvent.click(await screen.findByRole('button', { name: 'No HTTPS · Add' }))
    expect(useHttpsIntentStore.getState().pending).toEqual({ 'conn-1': 'plain.conf:1' })
  })

  it('stays hidden when the matching block already has TLS', async () => {
    const lastReport = vi.fn(async () => ({ success: true, data: report() }))
    mockNovadeck({ 'ssl.lastReport': lastReport })
    render(<NoHttpsChip {...site} path="/var/www/secure" healthUrl="https://secure.example.com/up" />)
    await waitFor(() => expect(lastReport).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'No HTTPS · Add' })).not.toBeInTheDocument()
  })

  it('stays hidden when no SSL report exists yet', async () => {
    const lastReport = vi.fn(async () => ({ success: true, data: null }))
    mockNovadeck({ 'ssl.lastReport': lastReport })
    render(<NoHttpsChip {...site} />)
    await waitFor(() => expect(lastReport).toHaveBeenCalledWith('conn-1'))
    expect(screen.queryByRole('button', { name: 'No HTTPS · Add' })).not.toBeInTheDocument()
  })

  it('stays hidden when the site matches no block', async () => {
    const lastReport = vi.fn(async () => ({ success: true, data: report() }))
    mockNovadeck({ 'ssl.lastReport': lastReport })
    render(<NoHttpsChip {...site} path="/srv/elsewhere" healthUrl="http://127.0.0.1:3000/up" />)
    await waitFor(() => expect(lastReport).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'No HTTPS · Add' })).not.toBeInTheDocument()
  })
})

describe('SslView', () => {
  function mountView() {
    mockNovadeck({
      'ssl.check': vi.fn(async () => ({ success: true, data: report() })),
      'ssl.httpsReadiness': vi.fn(async () => ({ success: true, data: [readinessRow('plain.example.com')] })),
      'ssl.httpsPrep': vi.fn(() => new Promise(() => undefined)),
      'ssl.httpsEmail': vi.fn(async () => ({ success: true, data: '' })),
      'deploy.list': vi.fn(async () => ({ success: true, data: [] }))
    })
    render(<SslView connectionId="conn-1" sessionId="session-1" connectionStatus="connected" />)
  }

  it('opens the wizard from the header button and returns to the list on Cancel', async () => {
    mountView()
    await userEvent.click(await screen.findByRole('button', { name: 'Add HTTPS' }))
    expect(await screen.findByRole('heading', { name: 'Site and certificate' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: 'SSL' })).toBeInTheDocument()
  })

  it('opens the wizard pre-filled when another tab asks for a block', async () => {
    mountView()
    await screen.findByRole('heading', { name: 'SSL' })
    act(() => useHttpsIntentStore.getState().request('conn-1', 'plain.conf:1'))
    expect(await screen.findByRole('radio', { name: /plain\.example\.com/ })).toBeChecked()
    expect(useHttpsIntentStore.getState().pending).toEqual({})
  })
})
