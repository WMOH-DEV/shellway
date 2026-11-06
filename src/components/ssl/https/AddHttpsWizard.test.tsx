import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import type { IssueResult, PrepFacts, SslReport, VerifyResult } from '@/types/ssl'
import { failCheck, issueFailure, issueSuccess, okCheck, readinessRow, readyFacts, ubuntuFacts, verifyResult } from '@/utils/ssl/addHttps/testFixtures'
import { edgeOf, makeBlock, makeHost, makeReport } from '@/utils/ssl/testReport'
import { AddHttpsWizard } from './AddHttpsWizard'

const appBlock = makeBlock({
  id: 'app.conf:1',
  file: '/etc/nginx/sites-enabled/app.conf',
  names: ['app.example.com', 'www.app.example.com', 'old.example.com', '*.example.com'],
  root: '/var/www/app/public',
  tls: false
})
const blogBlock = makeBlock({ id: 'blog.conf:1', file: '/etc/nginx/sites-enabled/blog.conf', names: ['blog.example.com'], tls: false })
const deploySite = { config: { name: 'example-app', path: '/var/www/app', healthUrl: 'https://app.example.com/up' } }

const readiness = [
  readinessRow('app.example.com', { cloudflare: 'Proxied · Flexible' }),
  readinessRow('www.app.example.com'),
  readinessRow('old.example.com', { dns: failCheck('points to 198.51.100.7, not this server') })
]

interface Backend {
  prep: ReturnType<typeof vi.fn>
  install: ReturnType<typeof vi.fn>
  issue: ReturnType<typeof vi.fn>
  verify: ReturnType<typeof vi.fn>
  readiness: ReturnType<typeof vi.fn>
  emit: (runId: string, chunk: string) => void
}

interface BackendOptions {
  facts?: PrepFacts
  afterInstall?: PrepFacts
  issueResult?: IssueResult
  verifyResults?: VerifyResult[]
}

function setupBackend({ facts = readyFacts, afterInstall = readyFacts, issueResult = issueSuccess(), verifyResults = [verifyResult()] }: BackendOptions = {}): Backend {
  let listener: (runId: string, chunk: string) => void = () => undefined
  let installed = false
  const backend: Backend = {
    prep: vi.fn(async () => ({ success: true, data: installed ? afterInstall : facts })),
    install: vi.fn(async (_c: string, _r: string, runId: string) => {
      listener(runId, 'Installing certbot from the snap\n')
      installed = true
      return { success: true, data: { code: 0, output: '' } }
    }),
    issue: vi.fn(async () => ({ success: true, data: issueResult })),
    verify: vi.fn(),
    readiness: vi.fn(async () => ({ success: true, data: readiness })),
    emit: (runId, chunk) => listener(runId, chunk)
  }
  const queue = [...verifyResults]
  backend.verify.mockImplementation(async () => ({ success: true, data: queue.length > 1 ? queue.shift() : queue[0] }))
  mockNovadeck({
    'deploy.list': vi.fn(async () => ({ success: true, data: [deploySite] })),
    'ssl.httpsReadiness': backend.readiness,
    'ssl.httpsPrep': backend.prep,
    'ssl.httpsInstall': backend.install,
    'ssl.httpsIssue': backend.issue,
    'ssl.httpsVerify': backend.verify,
    'ssl.httpsEmail': vi.fn(async () => ({ success: true, data: 'admin@example.com' })),
    'ssl.onOutput': vi.fn((callback: (runId: string, chunk: string) => void) => {
      listener = callback
      return vi.fn()
    })
  })
  return backend
}

const defaultReport = (): SslReport => makeReport({
  blocks: [blogBlock, appBlock],
  hostnames: [
    makeHost({ name: 'app.example.com', blockId: 'app.conf:1', edge: edgeOf({ sslMode: 'flexible' }) }),
    makeHost({ name: 'www.app.example.com', blockId: 'app.conf:1', edge: edgeOf({ sslMode: 'off' }) })
  ]
})

function renderWizard(options: { blockId?: string | null; report?: SslReport } = {}) {
  const onCancel = vi.fn()
  const onFinished = vi.fn()
  render(
    <AddHttpsWizard
      connectionId="conn-1"
      sessionId="session-1"
      serverName="Test server"
      report={options.report ?? defaultReport()}
      blockId={options.blockId ?? null}
      onCancel={onCancel}
      onFinished={onFinished}
    />
  )
  return { onCancel, onFinished }
}

const user = () => userEvent.setup()

async function pickDeploySite(u: ReturnType<typeof user>) {
  await u.click(await screen.findByRole('radio', { name: /example-app/ }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'app.example.com' })).toBeChecked())
}

async function toReview(u: ReturnType<typeof user>) {
  await pickDeploySite(u)
  await u.click(screen.getByRole('button', { name: /Continue/ }))
  await screen.findByRole('heading', { name: 'Review and issue' })
}

describe('Add HTTPS step 1', () => {
  it('lists the Deploy site first, matched to its block, then the nginx block', async () => {
    setupBackend()
    renderWizard()
    await screen.findByRole('radio', { name: /example-app/ })
    expect(screen.getAllByRole('radio', { name: /example-app|blog\.example\.com|Other hostname/ }).map((r) => r.textContent)).toEqual([
      'example-appDeploy site/var/www/app · app.conf',
      'blog.example.comnginxblog.conf · no certificate',
      'Other hostname…Must match an nginx server block'
    ])
  })

  it('unticks and disables a name whose DNS check fails, and lists wildcards as not selectable', async () => {
    const u = user()
    setupBackend()
    renderWizard()
    await pickDeploySite(u)
    expect(screen.getByRole('checkbox', { name: 'www.app.example.com' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'old.example.com' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'old.example.com' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: '*.example.com' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('old.example.com points to 198.51.100.7, not this server, so it\'s left out.')
    expect(screen.getByText('2 names ready')).toBeInTheDocument()
  })

  it('checks the names again on request', async () => {
    const u = user()
    const backend = setupBackend()
    renderWizard()
    await pickDeploySite(u)
    await u.click(screen.getByRole('button', { name: /Check again/ }))
    await waitFor(() => expect(backend.readiness).toHaveBeenCalledTimes(2))
    expect(backend.readiness).toHaveBeenCalledWith('conn-1', 'session-1', ['app.example.com', 'www.app.example.com', 'old.example.com'])
  })

  it('opens pre-filled with the block it was started from', async () => {
    setupBackend()
    renderWizard({ blockId: 'blog.conf:1' })
    expect(await screen.findByRole('radio', { name: /blog\.example\.com/ })).toBeChecked()
  })

  it('needs a typed hostname to match an existing server block', async () => {
    const u = user()
    setupBackend()
    renderWizard()
    await u.click(await screen.findByRole('radio', { name: /Other hostname/ }))
    await u.type(screen.getByLabelText('Hostname'), 'missing.example.com')
    expect(screen.getByText('No nginx server block names missing.example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled()
    await u.clear(screen.getByLabelText('Hostname'))
    await u.type(screen.getByLabelText('Hostname'), 'blog.example.com')
    expect(await screen.findByRole('checkbox', { name: 'blog.example.com' })).toBeInTheDocument()
  })

  it('offers Let\'s Encrypt as recommended and Origin CA as disabled', async () => {
    setupBackend()
    renderWizard()
    const issuer = await screen.findByRole('radiogroup', { name: 'Certificate issuer' })
    expect(within(issuer).getByText('Recommended')).toBeInTheDocument()
    expect(within(issuer).getByRole('radio', { name: /Cloudflare Origin CA/ })).toBeDisabled()
    expect(within(issuer).getByText('Available with the Origin CA switch')).toBeInTheDocument()
  })
})

describe('Add HTTPS step 2', () => {
  async function toPrepare(facts: PrepFacts, overrides: BackendOptions = {}) {
    const u = user()
    const backend = setupBackend({ facts, ...overrides })
    renderWizard()
    await pickDeploySite(u)
    await u.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByRole('heading', { name: 'Prepare the server' })
    return { u, backend }
  }

  it('is skipped when certbot is ready', async () => {
    const u = user()
    setupBackend({ facts: readyFacts })
    renderWizard()
    await pickDeploySite(u)
    await waitFor(() => expect(screen.getByText('certbot 3.0.1 ready')).toBeInTheDocument())
    await u.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByRole('heading', { name: 'Review and issue' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Review and issue')
  })

  it('shows the plan with a tag per row', async () => {
    await toPrepare(ubuntuFacts)
    const plan = screen.getByRole('region', { name: 'Install plan' })
    expect(within(plan).getByText('snap install --classic certbot')).toBeInTheDocument()
    expect(within(plan).getByText('skipped · No packaged certbot found')).toBeInTheDocument()
    expect(within(plan).getAllByText('will run')).toHaveLength(2)
    expect(within(plan).getAllByText('check')).toHaveLength(3)
  })

  it('switches between the snap and distribution routes only when both exist', async () => {
    const { u } = await toPrepare(ubuntuFacts)
    const toggle = screen.getByRole('group', { name: 'Install route' })
    expect(within(toggle).getByRole('button', { name: "Snap (certbot's recommended way)" })).toHaveAttribute('aria-pressed', 'true')
    await u.click(within(toggle).getByRole('button', { name: 'From your distribution' }))
    expect(screen.getByText('DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx')).toBeInTheDocument()
    expect(screen.queryByText('snap install --classic certbot')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: "Using your distribution's packages" })).toHaveTextContent(/recommend the snap/)
    expect(screen.queryByRole('region', { name: "Following certbot's guide" })).not.toBeInTheDocument()
  })

  it('has no route toggle when only one route exists', async () => {
    await toPrepare({ ...ubuntuFacts, snapd: null })
    expect(screen.queryByRole('group', { name: 'Install route' })).not.toBeInTheDocument()
    expect(screen.getByText('DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx')).toBeInTheDocument()
  })

  it('stops with a reason and a link when there is no plan', async () => {
    await toPrepare({ ...ubuntuFacts, webServer: 'caddy' })
    expect(screen.getByRole('alert')).toHaveTextContent('Caddy gets and renews HTTPS certificates by itself. Nothing to install.')
    expect(within(screen.getByRole('alert')).getByRole('link', { name: "Open certbot's instructions" })).toHaveAttribute('href', expect.stringContaining('certbot.eff.org'))
    expect(screen.queryByRole('button', { name: 'Install certbot' })).not.toBeInTheDocument()
  })

  it('shows sudo-prefixed commands to run by hand when sudo is not passwordless, and re-checks on request', async () => {
    const { u, backend } = await toPrepare({ ...ubuntuFacts, fullSudo: false })
    expect(screen.getByText('sudo snap install --classic certbot')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install certbot' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy all/ })).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /Check again/ }))
    await waitFor(() => expect(backend.prep).toHaveBeenCalledTimes(2))
  })

  it('switches to manual mode on request', async () => {
    const { u, backend } = await toPrepare(ubuntuFacts)
    expect(screen.getByText('snap install --classic certbot')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: "I'll install it myself" }))
    expect(screen.getByText('sudo snap install --classic certbot')).toBeInTheDocument()
    expect(backend.install).not.toHaveBeenCalled()
  })

  it('installs once per click, streams the output, then re-checks and enables Continue', async () => {
    const { u, backend } = await toPrepare(ubuntuFacts, { afterInstall: readyFacts })
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Install certbot' }))
    expect(await screen.findByText('Installing certbot from the snap')).toBeInTheDocument()
    expect(backend.install).toHaveBeenCalledTimes(1)
    expect(backend.install).toHaveBeenCalledWith('conn-1', 'snap', expect.any(String))
    await waitFor(() => expect(backend.prep).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('certbot installed')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: /Continue/ })).toBeEnabled())
  })
})

describe('Add HTTPS step 3', () => {
  it('prefills the email and shows the exact staging and issue commands', async () => {
    const u = user()
    setupBackend()
    renderWizard()
    await toReview(u)
    await waitFor(() => expect(screen.getByLabelText("Email for Let's Encrypt")).toHaveValue('admin@example.com'))
    const commands = screen.getByRole('region', { name: 'Commands' })
    expect(within(commands).getByText(/^sudo -n certbot certonly --nginx --dry-run .* -d app\.example\.com -d www\.app\.example\.com$/)).toBeInTheDocument()
    expect(within(commands).getByText(/^sudo -n certbot --nginx .* --redirect$/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'nginx changes' })).toHaveTextContent('listen 443 ssl;')
    expect(screen.getByRole('region', { name: 'nginx changes' })).toHaveTextContent('/etc/ssl/shellway/backups/')
  })

  it('leaves the staging command out when staging is off and drops the redirect flag when redirect is off', async () => {
    const u = user()
    setupBackend()
    renderWizard()
    await toReview(u)
    await u.click(screen.getByRole('switch', { name: 'Test with staging first' }))
    await u.click(screen.getByRole('switch', { name: 'Redirect HTTP to HTTPS' }))
    const commands = screen.getByRole('region', { name: 'Commands' })
    expect(within(commands).queryByText(/--dry-run/)).not.toBeInTheDocument()
    expect(within(commands).getByText(/--no-redirect$/)).toBeInTheDocument()
  })

  it('needs a valid email before it shows commands or allows issuing', async () => {
    const u = user()
    setupBackend()
    renderWizard()
    await toReview(u)
    const email = screen.getByLabelText("Email for Let's Encrypt")
    await u.clear(email)
    await u.type(email, 'nope')
    expect(screen.getByText('Enter a valid email address to see the exact commands.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Test and issue certificate' })).toBeDisabled()
  })

  it('explains that the site keeps working when a picked name is proxied with Flexible or Off', async () => {
    const u = user()
    setupBackend()
    renderWizard()
    await toReview(u)
    const note = screen.getByRole('region', { name: 'Cloudflare' })
    expect(note).toHaveTextContent('app.example.com, www.app.example.com are proxied')
    expect(note).toHaveTextContent('Flexible and Off')
    expect(note).toHaveTextContent('Full (strict)')
  })

  it('says nothing was requested for real when the staging test fails', async () => {
    const u = user()
    const backend = setupBackend({ issueResult: issueFailure({ failedStage: 'staging', hint: 'Port 80 is blocked' }) })
    renderWizard()
    await toReview(u)
    await waitFor(() => expect(screen.getByLabelText("Email for Let's Encrypt")).toHaveValue('admin@example.com'))
    await u.click(screen.getByRole('button', { name: 'Test and issue certificate' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The staging test failed')
    expect(alert).toHaveTextContent('The nginx file was not changed.')
    expect(alert).toHaveTextContent('The real certificate was not requested')
    expect(alert).toHaveTextContent('Port 80 is blocked')
    expect(backend.issue).toHaveBeenCalledTimes(1)
    expect(backend.issue.mock.calls[0][2]).toMatchObject({ blockId: 'app.conf:1', names: ['app.example.com', 'www.app.example.com'], email: 'admin@example.com', redirect: true, staging: true })
    expect(screen.getByRole('heading', { name: 'Review and issue' })).toBeInTheDocument()
  })

  it('says the file was restored when nginx rejected the change', async () => {
    const u = user()
    setupBackend({ issueResult: issueFailure({ failedStage: 'nginx-test', restored: true }) })
    renderWizard()
    await toReview(u)
    await waitFor(() => expect(screen.getByLabelText("Email for Let's Encrypt")).toHaveValue('admin@example.com'))
    await u.click(screen.getByRole('button', { name: 'Test and issue certificate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The nginx file was restored from its backup (/etc/ssl/shellway/backups/app.conf.1800000000).')
  })

  it('streams the output while issuing', async () => {
    const u = user()
    const backend = setupBackend()
    let release: () => void = () => undefined
    backend.issue.mockImplementation(async (_c: string, _s: string, _r: unknown, runId: string) => {
      backend.emit(runId, 'Requesting a certificate for app.example.com\n')
      await new Promise<void>((resolve) => { release = resolve })
      return { success: true, data: issueSuccess() }
    })
    renderWizard()
    await toReview(u)
    await waitFor(() => expect(screen.getByLabelText("Email for Let's Encrypt")).toHaveValue('admin@example.com'))
    await u.click(screen.getByRole('button', { name: 'Test and issue certificate' }))
    expect(await screen.findByText('Requesting a certificate for app.example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
    release()
    await screen.findByRole('heading', { name: 'Verify' })
  })
})

describe('Add HTTPS verify', () => {
  async function issueAndVerify(verifyResults: VerifyResult[]) {
    const u = user()
    const backend = setupBackend({ verifyResults })
    const handlers = renderWizard()
    await toReview(u)
    await waitFor(() => expect(screen.getByLabelText("Email for Let's Encrypt")).toHaveValue('admin@example.com'))
    await u.click(screen.getByRole('button', { name: 'Test and issue certificate' }))
    await screen.findByRole('heading', { name: 'Verify' })
    return { u, backend, ...handlers }
  }

  it('verifies the issued names automatically and finishes back to the hostnames', async () => {
    const { u, backend, onFinished } = await issueAndVerify([verifyResult()])
    expect(await screen.findByRole('status')).toHaveTextContent('HTTPS is on and renewal works.')
    expect(backend.verify).toHaveBeenCalledWith('conn-1', ['app.example.com', 'www.app.example.com'], 'app.example.com')
    expect(screen.getByText(/Let's Encrypt · \d+ days? left/)).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Back to hostnames' }))
    expect(onFinished).toHaveBeenCalledTimes(1)
  })

  it('shows what failed with the next step and verifies again on request', async () => {
    const failing = verifyResult({ renewalTest: failCheck('port 80 refused'), timer: okCheck('scheduled') })
    const { u, backend } = await issueAndVerify([failing, verifyResult()])
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The renewal test failed (port 80 refused)')
    expect(alert).toHaveTextContent('Fix this, then press Verify again.')
    await u.click(screen.getByRole('button', { name: /Verify again/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('HTTPS is on and renewal works.')
    expect(backend.verify).toHaveBeenCalledTimes(2)
  })
})

describe('Add HTTPS navigation', () => {
  it('returns to the hostnames from Cancel', async () => {
    const u = user()
    setupBackend()
    const { onCancel, onFinished } = renderWizard()
    await u.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('goes back one step with Back', async () => {
    const u = user()
    setupBackend()
    renderWizard()
    await toReview(u)
    await u.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: 'Site and certificate' })).toBeInTheDocument()
  })
})
