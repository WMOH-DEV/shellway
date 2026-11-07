import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import type { AlertSettings, CloudflareStatus, ServerFacts, SslReport } from '@/types/ssl'
import { SslSettings } from './SslSettings'

const NOW = Math.floor(Date.now() / 1000)

const facts: ServerFacts = {
  nginx: '1.24.0',
  openssl: '3.0.13',
  certbot: '2.11.0',
  otherWebServer: null,
  apache: null,
  serving: 'nginx',
  nginxParse: 'full',
  renewal: { mechanism: 'certbot.timer', lastRun: NOW - 3600, lastResult: 'failed', output: 'Challenge failed for app.example.com' },
  sudo: { certbot: false, nginx: true, apache: false, full: false, installed: true },
  paths: { certbot: '/usr/bin/certbot', nginx: '/usr/sbin/nginx', apache: null },
  user: 'deploy',
  addresses: ['203.0.113.10']
}

const edge = { state: 'proxied' as const, zone: 'example.com', recordType: 'A', recordContent: '203.0.113.10', sslMode: 'strict' as const, unknownReason: null }

const report: SslReport = {
  checkedAt: NOW,
  facts,
  blocks: [],
  lineages: [],
  cloudflare: { saved: true, tokenHint: '…3f2a', error: null, permissions: [], zones: [] },
  hostnames: [
    { name: 'app.example.com', blockId: 'b1', wildcard: false, origin: null, lineage: null, edge, verdict: 'ok', reason: '', uncheckedSide: null },
    { name: 'api.example.com', blockId: 'b1', wildcard: false, origin: null, lineage: null, edge, verdict: 'ok', reason: '', uncheckedSide: null }
  ]
}

const connected: CloudflareStatus = {
  saved: true,
  tokenHint: '…3f2a',
  error: null,
  zones: [{ id: 'z1', name: 'example.com' }],
  permissions: [
    { id: 'monitoring', state: 'granted', lines: [{ label: 'Zone → Zone → Read', state: 'granted' }, { label: 'Zone → DNS → Read', state: 'granted' }, { label: 'Zone → Zone Settings → Read', state: 'granted' }] },
    { id: 'origin-ca', state: 'not-granted', lines: [{ label: 'Zone → SSL and Certificates → Edit', state: 'not-granted' }] },
    { id: 'zone-mode', state: 'unknown', lines: [{ label: 'Zone → Zone Settings → Edit', state: 'unknown' }] }
  ]
}

const empty: CloudflareStatus = { saved: false, tokenHint: '', error: null, permissions: [], zones: [] }

const alerts: AlertSettings = {
  probeEnabled: true,
  lastAlert: { host: 'api.example.com', verdict: 'will-break', at: NOW - 600 },
  unreachable: [{ host: 'staging.example.net', reason: 'the server refused the connection', at: NOW }]
}

function setup(status: CloudflareStatus, overrides: Record<string, unknown> = {}) {
  const api = {
    'ssl.cloudflareStatus': vi.fn().mockResolvedValue({ success: true, data: status }),
    'ssl.saveCloudflareToken': vi.fn().mockResolvedValue({ success: true, data: connected }),
    'ssl.removeCloudflareToken': vi.fn().mockResolvedValue({ success: true }),
    'ssl.alerts': vi.fn().mockResolvedValue({ success: true, data: alerts }),
    'ssl.setAlertsEnabled': vi.fn().mockResolvedValue({ success: true, data: { ...alerts, probeEnabled: false } }),
    ...overrides
  }
  mockNovadeck(api)
  const props = { connectionId: 'c1', report, checking: false, onBack: vi.fn(), onRecheck: vi.fn(), onCloudflareChanged: vi.fn(), onSetZoneStrict: vi.fn() }
  render(<SslSettings {...props} />)
  return { api, props }
}

describe('SslSettings Cloudflare card', () => {
  it('shows the token form with the permission list as instructions when no token is saved', async () => {
    setup(empty)
    expect(await screen.findByLabelText('API token')).toBeInTheDocument()
    expect(screen.getByText('Zone → DNS → Read')).toBeInTheDocument()
    expect(screen.getByText('not connected')).toBeInTheDocument()
    expect(screen.queryByText('granted')).not.toBeInTheDocument()
  })

  it('saves a pasted token, then tells the parent', async () => {
    const { api, props } = setup(empty)
    await userEvent.type(await screen.findByLabelText('API token'), ' test-token-123 ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api['ssl.saveCloudflareToken']).toHaveBeenCalledWith('test-token-123'))
    await waitFor(() => expect(props.onCloudflareChanged).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('connected')).toBeInTheDocument()
  })

  it('shows only the hint of a saved token, with permissions and zone coverage', async () => {
    setup(connected)
    expect(await screen.findByText(/3f2a/)).toBeInTheDocument()
    expect(screen.queryByLabelText('API token')).not.toBeInTheDocument()
    expect(screen.getByText('example.com · 2 hostnames')).toBeInTheDocument()
    expect(screen.getByText('Stored encrypted on this PC. Never sent to your servers.')).toBeInTheDocument()
  })

  it('removes the token and goes back to the empty state', async () => {
    const { api, props } = setup(connected)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api['ssl.removeCloudflareToken']).toHaveBeenCalled())
    expect(await screen.findByLabelText('API token')).toBeInTheDocument()
    expect(props.onCloudflareChanged).toHaveBeenCalledTimes(1)
  })

  it('explains a rejected token', async () => {
    setup({ ...connected, error: 'Cloudflare rejected this token.', permissions: [], zones: [] })
    expect(await screen.findByText('Cloudflare rejected this token.')).toBeInTheDocument()
    expect(screen.getByText('needs attention')).toBeInTheDocument()
  })

  it('offers Try again when the status cannot be loaded', async () => {
    const load = vi.fn().mockResolvedValueOnce({ success: false, error: 'Boom' }).mockResolvedValue({ success: true, data: empty })
    setup(empty, { 'ssl.cloudflareStatus': load })
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByLabelText('API token')).toBeInTheDocument()
  })
})

describe('SslSettings server checks', () => {
  it('shows the sudoers line for a failing sudo row and reveals the renewal output', async () => {
    const { props } = setup(empty)
    expect(await screen.findByText('deploy ALL=(root) NOPASSWD: /usr/bin/certbot')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show last renewal output' }))
    expect(screen.getByText('Challenge failed for app.example.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Run again' }))
    expect(props.onRecheck).toHaveBeenCalledTimes(1)
  })

  it('says there is no check yet when there is no report', async () => {
    mockNovadeck({ 'ssl.cloudflareStatus': vi.fn().mockResolvedValue({ success: true, data: empty }), 'ssl.alerts': vi.fn().mockResolvedValue({ success: true, data: alerts }) })
    render(<SslSettings connectionId="c1" report={null} checking={false} onBack={vi.fn()} onRecheck={vi.fn()} onCloudflareChanged={vi.fn()} onSetZoneStrict={vi.fn()} />)
    expect(await screen.findByText(/No server check yet/)).toBeInTheDocument()
  })
})

describe('SslSettings alerts', () => {
  it('shows the last alert and hostnames this PC cannot check', async () => {
    setup(empty)
    expect(await screen.findByText('api.example.com · will break soon · 10 min ago')).toBeInTheDocument()
    expect(screen.getByText('staging.example.net')).toBeInTheDocument()
    expect(screen.getByText(/the server refused the connection/)).toBeInTheDocument()
  })

  it('turns the background check off', async () => {
    const { api } = setup(empty)
    await userEvent.click(await screen.findByRole('switch'))
    await waitFor(() => expect(api['ssl.setAlertsEnabled']).toHaveBeenCalledWith(false))
  })
})

describe('SslSettings header', () => {
  it('goes back', async () => {
    const { props } = setup(empty)
    await userEvent.click(screen.getByRole('button', { name: 'Back to hostnames' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })
})
