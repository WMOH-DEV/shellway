import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import type { SslMode, ZoneHostProbe, ZoneModeResult, ZonePreflight } from '@/types/ssl'
import { edgeOf, makeHost, makeReport, NOW } from '@/utils/ssl/testReport'
import { HostnameDetail } from '../HostnameDetail'
import { SslView } from '../SslView'
import { ZoneList } from '../settings/ZoneList'
import { ZoneModeScreen } from './ZoneModeScreen'

const probe = (overrides: Partial<ZoneHostProbe>): ZoneHostProbe => ({
  name: 'app.example.com',
  recordType: 'A',
  origin: '203.0.113.10',
  state: 'pass',
  detail: '',
  ...overrides
})

const preflightOf = (hosts: ZoneHostProbe[], overrides: Partial<ZonePreflight> = {}): ZonePreflight => ({
  zoneId: 'z1',
  zone: 'example.com',
  currentMode: 'flexible',
  hosts,
  blockedReason: null,
  ...overrides
})

const modeResult = (overrides: Partial<ZoneModeResult> = {}): ZoneModeResult => ({ zone: 'example.com', previousMode: 'flexible', mode: 'strict', ...overrides })

const passing = preflightOf([probe({}), probe({ name: 'api.example.com', recordType: 'CNAME', origin: 'origin.example.net' })])

interface Backend {
  zonePreflight: ReturnType<typeof vi.fn>
  zoneSetMode: ReturnType<typeof vi.fn>
}

function setupBackend(preflight: ZonePreflight = passing, setMode: (mode: SslMode) => unknown = (mode) => ({ success: true, data: modeResult({ mode, previousMode: mode === 'strict' ? 'flexible' : 'strict' }) })): Backend {
  const backend: Backend = {
    zonePreflight: vi.fn(async () => ({ success: true, data: preflight })),
    zoneSetMode: vi.fn(async (_zone: string, mode: SslMode) => setMode(mode))
  }
  mockNovadeck({ 'ssl.zonePreflight': backend.zonePreflight, 'ssl.zoneSetMode': backend.zoneSetMode })
  return backend
}

function renderScreen() {
  const handlers = { onCancel: vi.fn(), onFinished: vi.fn() }
  render(<ZoneModeScreen zone="example.com" {...handlers} />)
  return handlers
}

const applyButton = () => screen.getByRole('button', { name: /Set to Full \(strict\)/ })

describe('preflight', () => {
  it('says what it is checking, then names the zone and the current mode', async () => {
    setupBackend()
    renderScreen()
    expect(screen.getByText('Checking every proxied hostname in example.com from this computer…')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Full (strict) for example.com' })).toBeInTheDocument()
    await screen.findByRole('table')
    expect(screen.getByText('Current mode: Flexible')).toBeInTheDocument()
  })

  it('shows the three states per hostname with record type and origin', async () => {
    setupBackend(preflightOf([
      probe({}),
      probe({ name: 'old.example.com', state: 'fail', detail: 'the certificate expired' }),
      probe({ name: 'hidden.example.com', recordType: 'AAAA', origin: '2001:db8::10', state: 'unknown', detail: 'the connection timed out' })
    ]))
    renderScreen()
    const table = await screen.findByRole('table')
    const rowOf = (name: string) => within(table).getByRole('row', { name: new RegExp(name.replace(/\./g, '\\.')) })
    expect(within(rowOf('app.example.com')).getByText('Passes')).toBeInTheDocument()
    expect(within(rowOf('old.example.com')).getByText('Would break: the certificate expired')).toBeInTheDocument()
    expect(within(rowOf('hidden.example.com')).getByText("Couldn't check: the connection timed out")).toBeInTheDocument()
    expect(within(rowOf('hidden.example.com')).getByText('AAAA')).toBeInTheDocument()
    expect(within(rowOf('hidden.example.com')).getByText('2001:db8::10')).toBeInTheDocument()
  })

  it('lets a clean zone be applied without any confirmation', async () => {
    setupBackend()
    renderScreen()
    await screen.findByRole('table')
    expect(applyButton()).toBeEnabled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('blocks applying when a hostname would break and lists the names', async () => {
    const backend = setupBackend(preflightOf([probe({}), probe({ name: 'old.example.com', state: 'fail', detail: 'self-signed' })]))
    renderScreen()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('old.example.com')
    expect(applyButton()).toBeDisabled()
    await userEvent.click(applyButton())
    expect(backend.zoneSetMode).not.toHaveBeenCalled()
  })

  it('blocks applying with the reason from the preflight itself', async () => {
    setupBackend(preflightOf([], { blockedReason: 'The token cannot edit zone settings' }))
    renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('The token cannot edit zone settings')
    expect(applyButton()).toBeDisabled()
  })

  it('shows a load error and retries with Check again', async () => {
    const backend = setupBackend()
    backend.zonePreflight.mockResolvedValueOnce({ success: false, error: 'Cloudflare is unreachable' })
    renderScreen()
    expect(await screen.findByRole('alert')).toHaveTextContent('Cloudflare is unreachable')
    expect(applyButton()).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await screen.findByRole('table')
    expect(backend.zonePreflight).toHaveBeenCalledTimes(2)
    expect(applyButton()).toBeEnabled()
  })

  it('cancels without changing anything', async () => {
    const backend = setupBackend()
    const { onCancel } = renderScreen()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(backend.zoneSetMode).not.toHaveBeenCalled()
  })
})

describe('hostnames that could not be checked', () => {
  const unknownZone = preflightOf([probe({}), probe({ name: 'hidden.example.com', state: 'unknown', detail: 'the connection timed out' })])

  it('needs the confirmation checkbox and sends the confirmed names', async () => {
    const backend = setupBackend(unknownZone)
    renderScreen()
    await screen.findByRole('table')
    expect(applyButton()).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: "I've checked these hostnames myself" }))
    expect(applyButton()).toBeEnabled()
    await userEvent.click(applyButton())
    await waitFor(() => expect(backend.zoneSetMode).toHaveBeenCalledWith('example.com', 'strict', ['hidden.example.com']))
  })

  it('asks again after the hostnames are checked again', async () => {
    setupBackend(unknownZone)
    renderScreen()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(screen.getByRole('checkbox')).not.toBeChecked())
    expect(applyButton()).toBeDisabled()
  })

  it('sends no names when nothing needed confirming', async () => {
    const backend = setupBackend()
    renderScreen()
    await screen.findByRole('table')
    await userEvent.click(applyButton())
    await waitFor(() => expect(backend.zoneSetMode).toHaveBeenCalledWith('example.com', 'strict', []))
  })
})

describe('applying', () => {
  it('confirms the change, then sets the previous mode back', async () => {
    const backend = setupBackend()
    const { onFinished } = renderScreen()
    await screen.findByRole('table')
    await userEvent.click(applyButton())
    expect(await screen.findByText('example.com now uses Full (strict).')).toBeInTheDocument()
    expect(screen.getByText('Current mode: Full (strict)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Set back to Flexible' }))
    await waitFor(() => expect(backend.zoneSetMode).toHaveBeenLastCalledWith('example.com', 'flexible', []))
    expect(await screen.findByText('example.com is back to Flexible.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Set back to/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Back to hostnames' }))
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('offers no way back when the previous mode is unknown', async () => {
    setupBackend(passing, () => ({ success: true, data: modeResult({ previousMode: null }) }))
    renderScreen()
    await screen.findByRole('table')
    await userEvent.click(applyButton())
    await screen.findByText('example.com now uses Full (strict).')
    expect(screen.queryByRole('button', { name: /Set back to/ })).not.toBeInTheDocument()
  })

  it('disables every button while the change is in flight and submits once', async () => {
    let finish: (value: unknown) => void = () => undefined
    const backend = setupBackend()
    backend.zoneSetMode.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    renderScreen()
    await screen.findByRole('table')
    await userEvent.click(applyButton())
    expect(applyButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled()
    await userEvent.click(applyButton())
    expect(backend.zoneSetMode).toHaveBeenCalledTimes(1)
    finish({ success: true, data: modeResult() })
    expect(await screen.findByText('example.com now uses Full (strict).')).toBeInTheDocument()
  })

  it('shows the error and allows trying again', async () => {
    const backend = setupBackend()
    backend.zoneSetMode.mockResolvedValueOnce({ success: false, error: 'Cloudflare refused the change' })
    renderScreen()
    await screen.findByRole('table')
    await userEvent.click(applyButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Cloudflare refused the change')
    expect(screen.queryByText(/now uses/)).not.toBeInTheDocument()
    expect(applyButton()).toBeEnabled()
  })

  it('shows the error when setting the mode back fails and keeps the button', async () => {
    const backend = setupBackend()
    renderScreen()
    await screen.findByRole('table')
    await userEvent.click(applyButton())
    await screen.findByText('example.com now uses Full (strict).')
    backend.zoneSetMode.mockResolvedValueOnce({ success: false, error: 'Cloudflare is unreachable' })
    await userEvent.click(screen.getByRole('button', { name: 'Set back to Flexible' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cloudflare is unreachable')
    expect(screen.getByRole('button', { name: 'Set back to Flexible' })).toBeEnabled()
    expect(screen.getByText('example.com now uses Full (strict).')).toBeInTheDocument()
  })
})

describe('entry points', () => {
  const setAction = /Set example\.com to Full \(strict\)/

  function renderDetail(edgeOverrides: Parameters<typeof edgeOf>[0]) {
    const onSetZoneStrict = vi.fn()
    const host = makeHost({ edge: edgeOf(edgeOverrides) })
    render(
      <HostnameDetail
        connectionId="conn-1"
        sessionId="session-1"
        host={host}
        report={makeReport({ hostnames: [host] })}
        now={NOW}
        loading={false}
        error={null}
        run={{ lineage: null, running: null, output: '', outcome: null, start: vi.fn() }}
        onBack={vi.fn()}
        onAddHttps={vi.fn()}
        onSwitchOrigin={vi.fn()}
        onSetZoneStrict={onSetZoneStrict}
        onRefresh={vi.fn()}
      />
    )
    return onSetZoneStrict
  }

  it('is offered on a proxied hostname whose zone is not strict, with the zone-wide note', async () => {
    const onSetZoneStrict = renderDetail({ sslMode: 'flexible' })
    expect(screen.getByText(setAction)).toBeInTheDocument()
    expect(screen.getByText(/whole zone, not only this hostname/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Check zone' }))
    expect(onSetZoneStrict).toHaveBeenCalledWith('example.com')
  })

  it('is hidden when the zone is already strict', () => {
    renderDetail({ sslMode: 'strict' })
    expect(screen.queryByText(setAction)).not.toBeInTheDocument()
  })

  it('is hidden when the hostname is not proxied', () => {
    renderDetail({ state: 'dns-only', sslMode: 'flexible' })
    expect(screen.queryByText(setAction)).not.toBeInTheDocument()
  })

  it('is offered next to each non-strict zone in the Cloudflare card, with its current mode', async () => {
    const onSetStrict = vi.fn()
    const hostnames = [
      makeHost({ edge: edgeOf({ zone: 'example.com', sslMode: 'flexible' }) }),
      makeHost({ name: 'www.example.net', edge: edgeOf({ zone: 'example.net', sslMode: 'strict' }) })
    ]
    render(<ZoneList zones={[{ id: 'z1', name: 'example.com' }, { id: 'z2', name: 'example.net' }]} hostnames={hostnames} onSetStrict={onSetStrict} />)
    expect(screen.getByText(/SSL mode: Flexible/)).toBeInTheDocument()
    expect(screen.getByText(/SSL mode: Full \(strict\)/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set example.net to Full (strict)' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Set example.com to Full (strict)' }))
    expect(onSetStrict).toHaveBeenCalledWith('example.com')
  })

  it('never offers to change a zone whose mode it could not see, because no site here uses it', () => {
    render(<ZoneList zones={[{ id: 'z1', name: 'example.org' }]} hostnames={[]} onSetStrict={vi.fn()} />)
    expect(screen.getByText('SSL mode not checked: no site here uses this zone')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Set example.org/ })).not.toBeInTheDocument()
  })
})

describe('inside the SSL view', () => {
  function setupView() {
    const report = makeReport({ hostnames: [makeHost({ edge: edgeOf({ sslMode: 'flexible' }) })] })
    const check = vi.fn(async () => ({ success: true, data: report }))
    const backend = setupBackend()
    mockNovadeck({ 'ssl.check': check, 'ssl.zonePreflight': backend.zonePreflight, 'ssl.zoneSetMode': backend.zoneSetMode })
    render(<SslView connectionId="conn-1" sessionId="session-1" connectionStatus="connected" />)
    return { check }
  }

  async function openZoneScreen() {
    await userEvent.click(await screen.findByRole('button', { name: /^app\.example\.com/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Check zone' }))
    await screen.findByRole('heading', { name: 'Full (strict) for example.com' })
  }

  it('returns to the hostname detail on Cancel', async () => {
    setupView()
    await openZoneScreen()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: 'app.example.com' })).toBeInTheDocument()
  })

  it('checks the hostnames again after a change when going back to the list', async () => {
    const { check } = setupView()
    await openZoneScreen()
    await screen.findByRole('table')
    await userEvent.click(applyButton())
    await screen.findByText('example.com now uses Full (strict).')
    expect(check).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Back to hostnames' }))
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('heading', { name: 'Full (strict) for example.com' })).not.toBeInTheDocument()
  })
})
