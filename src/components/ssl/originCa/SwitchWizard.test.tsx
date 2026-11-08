import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import type { SslReport, SwitchPrepared, SwitchResult } from '@/types/ssl'
import { edgeOf, makeHost } from '@/utils/ssl/testReport'
import { preparedSwitch, switchApplied, switchBlock, switchFailed, switchReport } from '@/utils/ssl/switchWizard/testFixtures'
import { SslView } from '../SslView'
import { SwitchWizard } from './SwitchWizard'

interface Backend {
  prepare: ReturnType<typeof vi.fn>
  apply: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  undo: ReturnType<typeof vi.fn>
  emit: (runId: string, chunk: string) => void
}

interface BackendOptions {
  prepared?: SwitchPrepared
  prepareError?: string
  applied?: SwitchResult
  applyError?: string
  undone?: SwitchResult
}

function setupBackend({ prepared = preparedSwitch(), prepareError, applied = switchApplied(), applyError, undone = switchApplied({ output: 'Restored the site file' }) }: BackendOptions = {}): Backend {
  let listener: (runId: string, chunk: string) => void = () => undefined
  const backend: Backend = {
    prepare: vi.fn(async (_c: string, _s: string, _request: unknown, runId: string) => {
      listener(runId, 'Generating the key\n')
      return prepareError ? { success: false, error: prepareError } : { success: true, data: prepared }
    }),
    apply: vi.fn(async (_c: string, _s: string, _id: string, runId: string) => {
      listener(runId, 'Backing up the site file\n')
      return applyError ? { success: false, error: applyError } : { success: true, data: applied }
    }),
    cancel: vi.fn(async () => ({ success: true })),
    undo: vi.fn(async () => ({ success: true, data: undone })),
    emit: (runId, chunk) => listener(runId, chunk)
  }
  mockNovadeck({
    'ssl.originPrepare': backend.prepare,
    'ssl.originApply': backend.apply,
    'ssl.originCancel': backend.cancel,
    'ssl.originUndo': backend.undo,
    'ssl.onOutput': vi.fn((callback: (runId: string, chunk: string) => void) => {
      listener = callback
      return vi.fn()
    })
  })
  return backend
}

function wizardFor(report: SslReport, handlers: { onCancel: () => void; onFinished: () => void }) {
  return (
    <SwitchWizard
      connectionId="conn-1"
      sessionId="session-1"
      report={report}
      host={report.hostnames[0]}
      onCancel={handlers.onCancel}
      onFinished={handlers.onFinished}
    />
  )
}

function renderWizard(report: SslReport = switchReport()) {
  const handlers = { onCancel: vi.fn(), onFinished: vi.fn() }
  const view = render(wizardFor(report, handlers))
  return { ...handlers, container: view.container, rerenderWith: (next: SslReport) => view.rerender(wizardFor(next, handlers)), unmount: view.unmount }
}

const user = () => userEvent.setup()

async function toReview(u: ReturnType<typeof user>) {
  await u.click(screen.getByRole('button', { name: /Continue/ }))
  await screen.findByRole('heading', { name: 'Review the nginx change' })
}

async function toApplied(u: ReturnType<typeof user>) {
  await toReview(u)
  await u.click(screen.getByRole('button', { name: /Apply and verify/ }))
  await screen.findByRole('button', { name: 'Back to hostnames' })
}

describe('Switch to Origin CA step 1', () => {
  it('shows the header, the five steps and the orange cloud warning', () => {
    setupBackend()
    renderWizard()
    expect(screen.getByRole('heading', { name: 'Switch to Cloudflare Origin CA' })).toBeInTheDocument()
    expect(screen.getByText('app.example.com', { selector: 'header span' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Switch steps' })).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Explain and confirm')
    const warning = screen.getByRole('region', { name: 'Keep the orange cloud on' })
    expect(warning).toHaveTextContent('Only Cloudflare trusts this certificate. If you set the record to DNS only, visitors get a certificate error.')
    expect(warning).toHaveTextContent('Shellway will flag this hostname as Broken now if that happens.')
  })

  it('defaults to 15 years and ECC with toggle buttons', () => {
    setupBackend()
    renderWizard()
    const validity = screen.getByRole('group', { name: 'Validity' })
    expect(within(validity).getAllByRole('button')).toHaveLength(4)
    expect(within(validity).getByRole('button', { name: /^15 years/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(validity).getByRole('button', { name: /^1 year/ })).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByRole('group', { name: 'Key type' })).getByRole('button', { name: /^ECC/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('lists every name in the server block and the two connections', () => {
    setupBackend()
    renderWizard()
    expect(screen.getByRole('region', { name: 'What changes' })).toHaveTextContent('www.app.example.com')
    expect(screen.getByRole('region', { name: 'The two HTTPS connections' })).toBeInTheDocument()
  })

  it('sends the defaults in the prepare request', async () => {
    const u = user()
    const backend = setupBackend()
    renderWizard()
    await toReview(u)
    expect(backend.prepare).toHaveBeenCalledTimes(1)
    expect(backend.prepare).toHaveBeenCalledWith('conn-1', 'session-1', { blockId: 'app.conf:9', keyType: 'ecc', validityYears: 15 }, expect.any(String))
  })

  it('sends the chosen validity and key type', async () => {
    const u = user()
    const backend = setupBackend()
    renderWizard()
    await u.click(within(screen.getByRole('group', { name: 'Validity' })).getByRole('button', { name: /^2 years/ }))
    await u.click(within(screen.getByRole('group', { name: 'Key type' })).getByRole('button', { name: /^RSA/ }))
    expect(within(screen.getByRole('group', { name: 'Validity' })).getByRole('button', { name: /^2 years/ })).toHaveAttribute('aria-pressed', 'true')
    await toReview(u)
    expect(backend.prepare).toHaveBeenCalledWith('conn-1', 'session-1', { blockId: 'app.conf:9', keyType: 'rsa', validityYears: 2 }, expect.any(String))
  })

  it('blocks Continue and says which names would break', () => {
    setupBackend()
    const blocked = switchReport({
      hostnames: [
        makeHost({ name: 'app.example.com', blockId: switchBlock.id }),
        makeHost({ name: 'www.app.example.com', blockId: switchBlock.id, edge: edgeOf({ state: 'dns-only' }) })
      ]
    })
    renderWizard(blocked)
    expect(screen.getByRole('alert')).toHaveTextContent('These names would break: www.app.example.com')
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
  })

  it('leaves without calling originCancel when nothing was prepared', async () => {
    const backend = setupBackend()
    const { onCancel } = renderWizard()
    await user().click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
    expect(backend.cancel).not.toHaveBeenCalled()
  })
})

describe('Switch to Origin CA steps 2 and 3', () => {
  it('streams the output while the key is made and Cloudflare signs', async () => {
    const u = user()
    let finish: (value: unknown) => void = () => undefined
    const backend = setupBackend()
    backend.prepare.mockImplementationOnce(async (_c: string, _s: string, _r: unknown, runId: string) => {
      backend.emit(runId, 'Generating the key\n')
      return new Promise((resolve) => { finish = resolve })
    })
    renderWizard()
    await u.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByText('Generating the key')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Key and CSR on server')
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Leave the switch' })).toBeDisabled()
    const runId = backend.prepare.mock.calls[0][3]
    act(() => backend.emit(runId, 'Asking Cloudflare to sign\n'))
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Cloudflare signs')
    await act(async () => finish({ success: true, data: preparedSwitch() }))
    expect(await screen.findByRole('heading', { name: 'Review the nginx change' })).toBeInTheDocument()
  })

  it('shows the error with Try again and Back, and Try again prepares once more', async () => {
    const u = user()
    const backend = setupBackend({ prepareError: 'Cloudflare refused the request' })
    renderWizard()
    await u.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cloudflare refused the request')
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing in nginx was changed.')
    await u.click(screen.getByRole('button', { name: /Try again/ }))
    await waitFor(() => expect(backend.prepare).toHaveBeenCalledTimes(2))
    await u.click(await screen.findByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Explain and confirm' })).toBeInTheDocument()
  })

  it('does not prepare again from Try again when the report now blocks the switch', async () => {
    const u = user()
    const backend = setupBackend({ prepareError: 'Cloudflare refused the request' })
    const { rerenderWith } = renderWizard()
    await u.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByRole('alert')
    rerenderWith(switchReport({
      hostnames: [
        makeHost({ name: 'app.example.com', blockId: switchBlock.id }),
        makeHost({ name: 'www.app.example.com', blockId: switchBlock.id, edge: edgeOf({ state: 'dns-only' }) })
      ]
    }))
    expect(screen.getByRole('button', { name: /Try again/ })).toBeDisabled()
    expect(backend.prepare).toHaveBeenCalledTimes(1)
  })

  it('cancels a switch that finished preparing after the wizard was closed', async () => {
    const u = user()
    let finish: (value: unknown) => void = () => undefined
    const backend = setupBackend()
    backend.prepare.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const { unmount } = renderWizard()
    await u.click(screen.getByRole('button', { name: /Continue/ }))
    unmount()
    await act(async () => finish({ success: true, data: preparedSwitch() }))
    expect(backend.cancel).toHaveBeenCalledWith('conn-1', 'switch-1')
  })
})

describe('Switch to Origin CA step 4', () => {
  it('summarises the certificate and every name', async () => {
    const u = user()
    setupBackend()
    renderWizard()
    await toReview(u)
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Review the change')
    const summary = screen.getByRole('region', { name: 'Certificate' })
    expect(summary).toHaveTextContent('Cloudflare Origin CA · ECC · 15 years')
    expect(summary).toHaveTextContent('Valid until')
    expect(within(summary).getAllByText('proxied · zone example.com')).toHaveLength(2)
    expect(summary).toHaveTextContent('Private key made on the server, never left it')
  })

  it('renders the diff with line numbers, tinted rows and counts', async () => {
    const u = user()
    setupBackend()
    const { container } = renderWizard()
    await toReview(u)
    const diff = screen.getByRole('region', { name: 'site change' })
    expect(diff).toHaveTextContent('/etc/nginx/sites-enabled/app.conf')
    expect(diff).toHaveTextContent('server block at line 9')
    expect(within(diff).getByText('+2')).toBeInTheDocument()
    expect(within(diff).getByText('-2')).toBeInTheDocument()
    const rows = [...container.querySelectorAll('[data-kind]')]
    expect(rows.map((row) => row.getAttribute('data-kind'))).toEqual(['same', 'remove', 'remove', 'add', 'add', 'same'])
    expect(rows[1].className).toContain('bg-nd-error')
    expect(rows[3].className).toContain('bg-nd-success')
    expect(rows[1].textContent).toBe('9-    ssl_certificate /etc/letsencrypt/live/app.example.com/fullchain.pem;')
    expect(rows[3].textContent).toBe('9+    ssl_certificate /etc/ssl/shellway/app.example.com.pem;')
  })

  it('lists what runs as root and reveals the script on request', async () => {
    const u = user()
    setupBackend()
    renderWizard()
    await toReview(u)
    const root = screen.getByRole('region', { name: 'Runs as root' })
    expect(root).toHaveTextContent("sent to sudo -n sh -s so a dropped connection can't leave it half-done")
    const steps = within(root).getAllByRole('listitem').map((item) => item.textContent)
    expect(steps[0]).toBe('Back up the site file to /etc/ssl/shellway/backups/app.example.com-20261106.conf')
    expect(steps[1]).toBe('Replace the two certificate lines')
    expect(steps[2]).toBe('nginx -t, then reload. If the test fails, the backup is restored.')
    expect(steps[3]).toContain('https://app.example.com/, https://www.app.example.com/ doesn\'t return 525/526')
    expect(screen.queryByLabelText('Script')).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Show script' }))
    expect(screen.getByLabelText('Script')).toHaveTextContent('set -eu')
    await u.click(screen.getByRole('button', { name: 'Hide script' }))
    expect(screen.queryByLabelText('Script')).not.toBeInTheDocument()
  })

  it('blocks Apply and lists the names that would break when the report changes underneath', async () => {
    const u = user()
    const backend = setupBackend()
    const { rerenderWith } = renderWizard()
    await toReview(u)
    rerenderWith(switchReport({
      hostnames: [
        makeHost({ name: 'app.example.com', blockId: switchBlock.id }),
        makeHost({ name: 'www.app.example.com', blockId: switchBlock.id, edge: edgeOf({ state: 'dns-only' }) })
      ]
    }))
    expect(screen.getByRole('alert')).toHaveTextContent('These names would break: www.app.example.com')
    expect(within(screen.getByRole('region', { name: 'Certificate' })).getByText('not proxied by Cloudflare')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Apply and verify/ })).toBeDisabled()
    expect(backend.apply).not.toHaveBeenCalled()
  })

  it('hints that Undo stays available', async () => {
    const u = user()
    setupBackend()
    renderWizard()
    await toReview(u)
    expect(screen.getByText('Undo stays available while the backup exists')).toBeInTheDocument()
  })

  it('cancels the prepared switch on Cancel', async () => {
    const u = user()
    const backend = setupBackend()
    const { onCancel } = renderWizard()
    await toReview(u)
    await u.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(backend.cancel).toHaveBeenCalledTimes(1)
    expect(backend.cancel).toHaveBeenCalledWith('conn-1', 'switch-1')
    expect(onCancel).toHaveBeenCalled()
  })

  it('cancels the prepared switch when the wizard is closed some other way', async () => {
    const u = user()
    const backend = setupBackend()
    const { unmount } = renderWizard()
    await toReview(u)
    unmount()
    expect(backend.cancel).toHaveBeenCalledWith('conn-1', 'switch-1')
  })

  it('keeps the prepared switch when going back and forward with the same choices', async () => {
    const u = user()
    const backend = setupBackend()
    renderWizard()
    await toReview(u)
    await u.click(screen.getByRole('button', { name: 'Back' }))
    await toReview(u)
    expect(backend.prepare).toHaveBeenCalledTimes(1)
    expect(backend.cancel).not.toHaveBeenCalled()
  })

  it('cancels the old switch and prepares again when a choice changes after going back', async () => {
    const u = user()
    const backend = setupBackend()
    renderWizard()
    await toReview(u)
    await u.click(screen.getByRole('button', { name: 'Back' }))
    await u.click(within(screen.getByRole('group', { name: 'Key type' })).getByRole('button', { name: /^RSA/ }))
    expect(backend.cancel).toHaveBeenCalledWith('conn-1', 'switch-1')
    await toReview(u)
    expect(backend.prepare).toHaveBeenCalledTimes(2)
    expect(backend.prepare).toHaveBeenLastCalledWith('conn-1', 'session-1', { blockId: 'app.conf:9', keyType: 'rsa', validityYears: 15 }, expect.any(String))
  })
})

describe('Switch to Origin CA step 5', () => {
  it('applies the prepared switch once, streams the output and disables leaving meanwhile', async () => {
    const u = user()
    let finish: (value: unknown) => void = () => undefined
    const backend = setupBackend()
    renderWizard()
    await toReview(u)
    backend.apply.mockImplementationOnce(async (_c: string, _s: string, _id: string, runId: string) => {
      backend.emit(runId, 'Backing up the site file\n')
      return new Promise((resolve) => { finish = resolve })
    })
    await u.click(screen.getByRole('button', { name: /Apply and verify/ }))
    expect(await screen.findByText('Backing up the site file')).toBeInTheDocument()
    expect(backend.apply).toHaveBeenCalledTimes(1)
    expect(backend.apply).toHaveBeenCalledWith('conn-1', 'session-1', 'switch-1', expect.any(String))
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Apply and verify')
    expect(screen.getByRole('button', { name: 'Leave the switch' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await act(async () => finish({ success: true, data: switchApplied() }))
    expect(await screen.findByRole('button', { name: 'Back to hostnames' })).toBeEnabled()
  })

  it('reports success with the verified names, Undo switch and Back to hostnames', async () => {
    const u = user()
    const backend = setupBackend()
    const { onFinished } = renderWizard()
    await toApplied(u)
    expect(screen.getByText(/The switch is done/)).toBeInTheDocument()
    const names = screen.getByRole('region', { name: 'Names' })
    expect(within(names).getByText('app.example.com')).toBeInTheDocument()
    expect(within(names).getByText('www.app.example.com')).toBeInTheDocument()
    expect(within(names).getAllByText(/Cloudflare Origin CA · \d+ days left/).length).toBe(2)
    expect(screen.getByRole('button', { name: /Undo switch/ })).toBeEnabled()
    expect(backend.cancel).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Back to hostnames' }))
    expect(onFinished).toHaveBeenCalled()
  })

  it('undoes the switch for this hostname and streams the output', async () => {
    const u = user()
    const backend = setupBackend()
    renderWizard()
    await toApplied(u)
    await u.click(screen.getByRole('button', { name: /Undo switch/ }))
    await waitFor(() => expect(backend.undo).toHaveBeenCalledWith('conn-1', 'session-1', 'app.example.com', true, expect.any(String)))
    expect(await screen.findByText(/The old site file is back/)).toBeInTheDocument()
    expect(screen.getByText('Switch undone')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Undo switch/ })).not.toBeInTheDocument()
  })

  it('says the backup was restored when the switch failed and it was', async () => {
    const u = user()
    const backend = setupBackend({ applied: switchFailed({ restored: true }) })
    renderWizard()
    await toApplied(u)
    expect(screen.getByRole('alert')).toHaveTextContent('nginx rejected the changed file')
    expect(screen.getByRole('alert')).toHaveTextContent('Shellway restored the backup (/etc/ssl/shellway/backups/app.example.com-20261106.conf) and reloaded nginx.')
    expect(screen.getByText('Backing up the site file')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Undo switch/ })).not.toBeInTheDocument()
    expect(backend.cancel).not.toHaveBeenCalled()
  })

  it('does not claim a restore when the backup was not restored', async () => {
    const u = user()
    setupBackend({ applied: switchFailed({ restored: false, failedStage: 'verify' }) })
    renderWizard()
    await toApplied(u)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The new certificate did not verify')
    expect(alert).toHaveTextContent('The backup was not restored automatically.')
    expect(alert).not.toHaveTextContent('Shellway restored the backup')
  })

  it('says nothing was changed when the script refused before touching the file', async () => {
    const u = user()
    setupBackend({ applied: switchFailed({ restored: false, failedStage: 'apply', backupPath: null }) })
    renderWizard()
    await toApplied(u)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Nothing on the server was changed.')
    expect(alert).not.toHaveTextContent('not restored automatically')
  })

  it('does not offer Try again or cancel the consumed switch when the apply call drops', async () => {
    const u = user()
    const backend = setupBackend({ applyError: 'Connection lost' })
    const { onFinished, onCancel } = renderWizard()
    await toReview(u)
    await u.click(screen.getByRole('button', { name: /Apply and verify/ }))
    expect(await screen.findByText('The switch could not run: Connection lost')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The connection dropped while applying.')
    expect(screen.getByRole('alert')).toHaveTextContent('Check the site before trying again.')
    expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Back to hostnames' }))
    expect(onFinished).toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(backend.apply).toHaveBeenCalledTimes(1)
    expect(backend.cancel).not.toHaveBeenCalled()
  })

  it('re-checks when leaving through the header arrow after the apply call dropped', async () => {
    const u = user()
    const backend = setupBackend({ applyError: 'Connection lost' })
    const { onFinished, onCancel, unmount } = renderWizard()
    await toReview(u)
    await u.click(screen.getByRole('button', { name: /Apply and verify/ }))
    await screen.findByRole('button', { name: 'Back to hostnames' })
    await u.click(screen.getByRole('button', { name: 'Leave the switch' }))
    expect(onFinished).toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    unmount()
    expect(backend.cancel).not.toHaveBeenCalled()
  })

  it('re-checks when leaving after a failed apply', async () => {
    const u = user()
    setupBackend({ applied: switchFailed() })
    const { onFinished, onCancel } = renderWizard()
    await toApplied(u)
    await u.click(screen.getByRole('button', { name: 'Leave the switch' }))
    expect(onFinished).toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('stops claiming the switch is done while the undo runs and after it succeeded', async () => {
    const u = user()
    let finish: (value: unknown) => void = () => undefined
    const backend = setupBackend()
    renderWizard()
    await toApplied(u)
    expect(screen.getByText(/The switch is done/)).toBeInTheDocument()
    backend.undo.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    await u.click(screen.getByRole('button', { name: /Undo switch/ }))
    expect(screen.queryByText(/The switch is done/)).not.toBeInTheDocument()
    expect(screen.queryByText(/nginx now presents/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Names' })).not.toBeInTheDocument()
    await act(async () => finish({ success: true, data: switchApplied({ output: 'Restored the site file' }) }))
    expect(await screen.findByText(/The old site file is back/)).toBeInTheDocument()
    expect(screen.queryByText(/The switch is done/)).not.toBeInTheDocument()
    expect(screen.queryByText(/nginx now presents/)).not.toBeInTheDocument()
    expect(screen.getByText(/The switch was undone/)).toBeInTheDocument()
  })

  it('does not cancel an applying switch when the wizard unmounts mid-run', async () => {
    const u = user()
    const backend = setupBackend()
    const { unmount } = renderWizard()
    await toReview(u)
    backend.apply.mockImplementationOnce(() => new Promise(() => undefined))
    await u.click(screen.getByRole('button', { name: /Apply and verify/ }))
    unmount()
    expect(backend.cancel).not.toHaveBeenCalled()
  })

  it('leaves through the header arrow with a re-check once the switch was applied', async () => {
    const u = user()
    setupBackend()
    const { onFinished, onCancel } = renderWizard()
    await toApplied(u)
    await u.click(screen.getByRole('button', { name: 'Leave the switch' }))
    expect(onFinished).toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('Switch to Origin CA from the SSL tab', () => {
  it('opens from the hostname detail and returns to it on Cancel', async () => {
    const u = user()
    setupBackend()
    const report = switchReport()
    mockNovadeck({ 'ssl.check': vi.fn(async () => ({ success: true, data: report })) })
    render(<SslView connectionId="conn-1" sessionId="session-1" connectionStatus="connected" />)
    await u.click(await screen.findByRole('button', { name: /^app\.example\.com/ }))
    await u.click(await screen.findByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('heading', { name: 'Switch to Cloudflare Origin CA' })).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: 'app.example.com' })).toBeInTheDocument()
  })
})
