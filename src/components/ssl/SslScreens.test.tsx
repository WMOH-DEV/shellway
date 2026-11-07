import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import { connectedCloudflare, DAY, edgeOf, makeBlock, makeFacts, makeHost, makeOrigin, makeReport, NOW, originExpiringIn, unknownEdge } from '@/utils/ssl/testReport'
import type { HostnameStatus, SslReport } from '@/types/ssl'
import { HostnameDetail } from './HostnameDetail'
import { useCertbotRun } from './detail/useCertbotRun'
import { HostnamesScreen } from './HostnamesScreen'

const shop = makeHost({
  name: 'shop.example.com', blockId: 'shop.conf:1', verdict: 'broken', reason: 'Visitors get error 526',
  origin: originExpiringIn(-2, { names: ['shop.example.com'] }), lineage: 'shop.example.com'
})
const api = makeHost({
  name: 'api.example.com', blockId: 'api.conf:1', verdict: 'will-break', reason: 'Expires in 6 days and renewal is not working',
  origin: originExpiringIn(6, { names: ['api.example.com'] }), lineage: 'api.example.com'
})
const apex = makeHost({ name: 'example.com', blockId: 'site.conf:1', origin: originExpiringIn(60, { names: ['example.com', 'www.example.com'] }), lineage: null })
const www = makeHost({ name: 'www.example.com', blockId: 'site.conf:1', origin: originExpiringIn(60, { names: ['example.com', 'www.example.com'] }), lineage: null })
const staging = makeHost({
  name: 'staging.example.net', blockId: 'staging.conf:1', verdict: 'unchecked', uncheckedSide: 'cloudflare', edge: unknownEdge,
  reason: 'Cloudflare side: zone not visible to the token', origin: originExpiringIn(52, { names: ['staging.example.net'] })
})

const failedRenewal = {
  mechanism: 'certbot.timer', lastRun: NOW - 4 * DAY, lastResult: 'failed',
  output: 'Renewing an existing certificate for api.example.com\nDomain: api.example.com\nDetail: 403 on /.well-known/acme-challenge/abc\nFailed to renew certificate api.example.com'
} as const

const report = (overrides: Partial<SslReport> = {}): SslReport => makeReport({
  facts: makeFacts({ renewal: failedRenewal }),
  hostnames: [shop, api, staging, apex, www],
  blocks: [
    makeBlock({ id: 'shop.conf:1', file: '/etc/nginx/sites-enabled/shop.conf', line: 4, names: ['shop.example.com'] }),
    makeBlock({ id: 'api.conf:1', file: '/etc/nginx/sites-enabled/api.conf', line: 14, names: ['api.example.com'], certPath: '/etc/letsencrypt/live/api.example.com/fullchain.pem' })
  ],
  ...overrides
})

function renderList(overrides: Partial<SslReport> = {}) {
  const onOpen = vi.fn()
  const onOpenSettings = vi.fn()
  render(
    <HostnamesScreen report={report(overrides)} serverName="Test server" now={NOW} loading={false} error={null} onRefresh={vi.fn()} onOpen={onOpen} onOpenSettings={onOpenSettings} onAddHttps={vi.fn()} />
  )
  return { onOpen, onOpenSettings }
}

describe('HostnamesScreen', () => {
  it('shows the header, critical banner and rows in report order', () => {
    renderList()
    expect(screen.getByText('5 hostnames served by nginx on Test server · checked 2 min ago')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('shop.example.com is down for visitors (error 526).')
    expect(screen.getByRole('alert')).toHaveTextContent('api.example.com follows in 6 days.')
    const names = screen.getAllByRole('button', { name: /\.example\.(com|net)$|^example\.com$/ }).map((b) => b.textContent)
    expect(names.filter((n) => !n?.startsWith('Fix'))).toEqual(['shop.example.com', 'api.example.com', 'staging.example.net', 'example.com', 'www.example.com'])
  })

  it('opens the detail from the banner, the name button and a click anywhere on the row', async () => {
    const { onOpen } = renderList()
    await userEvent.click(screen.getByRole('button', { name: 'Fix shop.example.com' }))
    await userEvent.click(screen.getByRole('button', { name: 'api.example.com' }))
    fireEvent.click(screen.getByText('Visitors get error 526'))
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual(['shop.example.com', 'api.example.com', 'shop.example.com'])
  })

  it('groups names that share a server block into one container', () => {
    renderList()
    const groups = screen.getAllByTestId('host-group')
    expect(groups).toHaveLength(4)
    expect(within(groups[3]).getAllByRole('button').map((b) => b.textContent)).toEqual(['example.com', 'www.example.com'])
  })

  it('filters with counts', async () => {
    renderList()
    expect(screen.getByRole('tab', { name: /^All\s*5$/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /^Needs action\s*2$/ }))
    expect(screen.queryByRole('button', { name: 'example.com' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'shop.example.com' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /^certbot\s*3$/ }))
    expect(screen.queryByRole('button', { name: 'example.com' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'staging.example.net' })).toBeInTheDocument()
  })

  it('shows the Cloudflare status and opens settings from it and from Server checks', async () => {
    const { onOpenSettings } = renderList()
    await userEvent.click(screen.getByRole('button', { name: /Cloudflare connected · 2 zones/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Server checks' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(2)
  })

  it('renders certificate, Cloudflare and renewal columns', () => {
    renderList()
    expect(screen.getByText('expired 2 days ago')).toBeInTheDocument()
    expect(screen.getByText('6 days left')).toBeInTheDocument()
    expect(screen.getByText('Zone not visible to the token')).toBeInTheDocument()
    expect(screen.getAllByText('certbot.timer failed').length).toBeGreaterThan(0)
  })

  it('has no banner when nothing is critical', () => {
    renderList({ hostnames: [apex] })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('notes a partial nginx parse above the list', () => {
    renderList({ facts: makeFacts({ nginxParse: 'partial' }) })
    expect(screen.getByRole('status')).toHaveTextContent('Part of nginx')
  })

  it('explains a server without nginx or Apache and names Caddy', () => {
    renderList({ facts: makeFacts({ nginx: null, otherWebServer: 'caddy' }), hostnames: [] })
    expect(screen.getByText('No nginx or Apache on this server')).toBeInTheDocument()
    expect(screen.getByText(/Caddy is installed here/)).toBeInTheDocument()
  })

  it('says Apache has no sites when Apache serves but lists none', () => {
    renderList({ facts: makeFacts({ nginx: null, apache: { version: '2.4.62', layout: 'debian' }, serving: 'apache' }), hostnames: [] })
    expect(screen.getByText(/Apache has no sites with a server name/)).toBeInTheDocument()
  })

  it('explains an nginx with no hostnames', () => {
    renderList({ hostnames: [] })
    expect(screen.getByText('No hostnames found')).toBeInTheDocument()
  })
})

interface DetailHarnessProps {
  host: HostnameStatus
  sslReport: SslReport
  onBack: () => void
  onSwitchOrigin: (name: string) => void
  onRefresh: () => Promise<void>
}

function DetailHarness({ host, sslReport, onBack, onSwitchOrigin, onRefresh }: DetailHarnessProps) {
  const run = useCertbotRun('c1', () => void onRefresh())
  const [open, setOpen] = useState(true)
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Reopen</button>
  const back = () => { onBack(); setOpen(false) }
  return <HostnameDetail connectionId="conn-1" sessionId="session-1" host={host} report={sslReport} now={NOW} loading={false} error={null} run={run} onBack={back} onAddHttps={vi.fn()} onSwitchOrigin={onSwitchOrigin} onSetZoneStrict={vi.fn()} onRefresh={onRefresh} />
}

function renderDetail(host: HostnameStatus, overrides: Partial<SslReport> = {}, api: Record<string, unknown> = {}) {
  mockNovadeck(api)
  const onRefresh = vi.fn().mockResolvedValue(undefined)
  const onBack = vi.fn()
  const onSwitchOrigin = vi.fn()
  render(<DetailHarness host={host} sslReport={report(overrides)} onBack={onBack} onSwitchOrigin={onSwitchOrigin} onRefresh={onRefresh} />)
  return { onRefresh, onBack, onSwitchOrigin }
}

describe('HostnameDetail', () => {
  it('shows the header with the key fact and a way back', async () => {
    const { onBack } = renderDetail(api)
    expect(screen.getByRole('heading', { name: 'api.example.com' })).toBeInTheDocument()
    expect(screen.getByText('Will break in 6 days')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to hostnames' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('draws the two connections with a failing dashed leg to the server', () => {
    renderDetail(api)
    const diagram = screen.getByRole('region', { name: 'The two HTTPS connections' })
    expect(within(diagram).getByText('Cloudflare shows visitors its own certificate. It renews it automatically.')).toBeInTheDocument()
    expect(within(diagram).getByText(/Your server's certificate expires on/)).toBeInTheDocument()
    const legs = diagram.querySelectorAll('[data-state]')
    expect([...legs].map((leg) => leg.getAttribute('data-state'))).toEqual(['ok', 'failing'])
    expect(diagram.querySelector('[data-line="dashed"]')).not.toBeNull()
  })

  it('collapses to one connection when the host is not proxied', () => {
    renderDetail(makeHost({ edge: edgeOf({ state: 'dns-only' }) }))
    const diagram = screen.getByRole('region', { name: 'The two HTTPS connections' })
    expect(within(diagram).queryByText('Cloudflare')).not.toBeInTheDocument()
    expect(diagram.querySelectorAll('[data-state]')).toHaveLength(1)
  })

  it('shows a neutral Cloudflare card with the reason when Cloudflare is unknown', () => {
    renderDetail(staging)
    expect(screen.getByText(/Shellway cannot see Cloudflare's side: zone not visible to the token/)).toBeInTheDocument()
  })

  it('opens the Why two explainer', async () => {
    renderDetail(api)
    await userEvent.click(screen.getByRole('button', { name: 'Why two?' }))
    expect(screen.getByRole('dialog', { name: 'Why two certificates' })).toBeInTheDocument()
  })

  it('lists the exact commands, with Test renewal as the primary action', () => {
    renderDetail(api)
    expect(screen.getByText('sudo -n certbot renew --no-random-sleep-on-renew --dry-run --cert-name api.example.com')).toBeInTheDocument()
    expect(screen.getByText('sudo -n certbot renew --no-random-sleep-on-renew --cert-name api.example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run test' }).className).toContain('bg-nd-accent')
    expect(screen.getByRole('button', { name: 'Renew' }).className).not.toContain('bg-nd-accent')
  })

  it('disables the Origin CA switch and says why when a precondition is missing', () => {
    renderDetail(api)
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.getByText('The Cloudflare token needs SSL and Certificates · Edit.')).toBeInTheDocument()
  })

  it('starts the Origin CA switch for this hostname when every precondition holds', async () => {
    const { onSwitchOrigin } = renderDetail(api, {
      facts: makeFacts({ renewal: failedRenewal, sudo: { certbot: true, nginx: true, apache: false, full: true } }),
      cloudflare: { ...connectedCloudflare, permissions: [{ id: 'origin-ca', state: 'granted', lines: [] }] }
    })
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onSwitchOrigin).toHaveBeenCalledWith('api.example.com')
  })

  it('explains why actions are missing without sudo or a certbot certificate', () => {
    renderDetail(api, { facts: makeFacts({ sudo: { certbot: false, nginx: true, apache: false, full: false } }) })
    expect(screen.getByText(/Passwordless sudo for certbot is missing/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run test' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Force renew…' })).not.toBeInTheDocument()
  })

  it('says there is nothing to renew for a name certbot does not manage', () => {
    renderDetail(apex)
    expect(screen.getByText(/nothing to renew from here/)).toBeInTheDocument()
  })

  it('runs an action, streams output, disables buttons, then re-checks once', async () => {
    let emit: (runId: string, chunk: string) => void = () => {}
    let finish: (value: unknown) => void = () => {}
    const runCertbot = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const onOutput = vi.fn((cb: typeof emit) => { emit = cb; return vi.fn() })
    const { onRefresh } = renderDetail(api, {}, { 'ssl.runCertbot': runCertbot, 'ssl.onOutput': onOutput })

    await userEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(runCertbot).toHaveBeenCalledWith('c1', 'api.example.com', 'test', expect.any(String))
    const runId = (runCertbot.mock.calls[0] as unknown[])[3] as string
    emit('another-run', 'ignored line')
    emit(runId, 'Simulating renewal of an existing certificate\n')
    expect(await screen.findByText('Simulating renewal of an existing certificate')).toBeInTheDocument()
    expect(screen.queryByText('ignored line')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Renew' })).toBeDisabled()
    expect(onRefresh).not.toHaveBeenCalled()

    finish({ success: true, data: { code: 0, output: 'done' } })
    expect(await screen.findByText('Test renewal succeeded')).toBeInTheDocument()
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Renew' })).toBeEnabled()
  })

  it('keeps a running action and its output after going back and reopening the hostname', async () => {
    let emit: (runId: string, chunk: string) => void = () => {}
    const runCertbot = vi.fn(() => new Promise(() => {}))
    const onOutput = vi.fn((cb: typeof emit) => { emit = cb; return vi.fn() })
    renderDetail(api, {}, { 'ssl.runCertbot': runCertbot, 'ssl.onOutput': onOutput })

    await userEvent.click(screen.getByRole('button', { name: 'Renew' }))
    const runId = (runCertbot.mock.calls[0] as unknown[])[3] as string
    emit(runId, 'Renewing an existing certificate\n')
    await userEvent.click(screen.getByRole('button', { name: /back/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(await screen.findByText('Renewing an existing certificate')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run test' })).toBeDisabled()
  })

  it('shows a failed action', async () => {
    const runCertbot = vi.fn().mockResolvedValue({ success: true, data: { code: 1, output: 'Challenge failed' } })
    renderDetail(api, {}, { 'ssl.runCertbot': runCertbot })
    await userEvent.click(screen.getByRole('button', { name: 'Renew' }))
    expect(await screen.findByText('Renewal failed (exit 1)')).toBeInTheDocument()
    expect(screen.getByText('Challenge failed')).toBeInTheDocument()
  })

  it('asks for confirmation before a forced renewal and mentions the weekly limit', async () => {
    const runCertbot = vi.fn().mockResolvedValue({ success: true, data: { code: 0, output: '' } })
    renderDetail(api, {}, { 'ssl.runCertbot': runCertbot })
    await userEvent.click(screen.getByRole('button', { name: 'Force renew…' }))
    expect(screen.getByText(/duplicate certificates to 5 per week/)).toBeInTheDocument()
    expect(runCertbot).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Force renew' }))
    expect(runCertbot).toHaveBeenCalledWith('c1', 'api.example.com', 'force', expect.any(String))
  })

  it('lists the facts', () => {
    renderDetail(api)
    const facts = screen.getByRole('region', { name: 'Facts' })
    expect(within(facts).getByText('/etc/nginx/sites-enabled/api.conf')).toBeInTheDocument()
    expect(within(facts).getByText(/: 14/)).toBeInTheDocument()
    expect(within(facts).getByText("Let's Encrypt · E6")).toBeInTheDocument()
    expect(within(facts).getByText('/etc/letsencrypt/live/api.example.com/fullchain.pem')).toBeInTheDocument()
    expect(within(facts).getByRole('button', { name: 'Copy certificate path' })).toBeInTheDocument()
  })

  it('shows the last renewal with failing lines and a hint', () => {
    renderDetail(api)
    const card = screen.getByRole('region', { name: 'Last renewal attempt' })
    expect(within(card).getByText('failed')).toBeInTheDocument()
    expect(card.querySelector('[data-tone="error"]')).not.toBeNull()
    expect(within(card).getByText(/could not reach the challenge file \(403\)/)).toBeInTheDocument()
  })

  it('shows no hint when the failure is not recognised', () => {
    renderDetail(api, { facts: makeFacts({ renewal: { ...failedRenewal, output: 'Something strange happened' } }) })
    const card = screen.getByRole('region', { name: 'Last renewal attempt' })
    expect(within(card).queryByText(/Fix that/)).not.toBeInTheDocument()
  })

  it('describes an Origin CA certificate without renewal actions', () => {
    const host = makeHost({ origin: makeOrigin({ kind: 'cloudflare-origin', notAfter: NOW + 5000 * DAY, issuer: 'CloudFlare, Inc. · CloudFlare Origin SSL Certificate Authority' }), lineage: null })
    renderDetail(host, {}, { 'ssl.originLeftover': vi.fn(async () => ({ success: true, data: null })) })
    expect(screen.getByText(/It does not need renewing/)).toBeInTheDocument()
  })
})
