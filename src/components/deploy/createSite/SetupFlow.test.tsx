import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { allTools } from '@/utils/createSite/testFixtures'
import { CreateSiteWizard } from './CreateSiteWizard'
import { FREE_NAME, LARAVEL_REPO, fakeBackend, makeContext } from './testRun'

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup(overrides: Record<string, unknown> = {}) {
  const backend = fakeBackend(overrides)
  const onClose = vi.fn()
  render(<CreateSiteWizard connectionId="conn-1" sessionId="session-1" serverName="Test server" initialRun={null} onClose={onClose} />)
  return { ...backend, onClose, user: userEvent.setup() }
}

async function enterDomain(user: ReturnType<typeof userEvent.setup>, domain = 'shop.example.com') {
  await user.type(await screen.findByLabelText('Domain'), domain)
  await user.tab()
}

const continueButton = () => screen.getByRole('button', { name: /Continue/ })

async function walkToStack(user: ReturnType<typeof userEvent.setup>) {
  await enterDomain(user)
  await user.type(screen.getByLabelText('Repository'), 'git@github.com:acme/shop.git')
  await waitFor(() => expect(continueButton()).toBeEnabled())
  await user.click(continueButton())
}

async function walkToReview(user: ReturnType<typeof userEvent.setup>) {
  await walkToStack(user)
  await user.click(continueButton())
  await screen.findByText('After going live')
  await user.click(continueButton())
  await screen.findByDisplayValue('admin@example.com')
  await user.click(continueButton())
}

describe('Create site, step 1', () => {
  it('disables a template the server cannot run and says why', async () => {
    const { user } = setup({ 'createSite.context': vi.fn().mockResolvedValue({ success: true, data: makeContext({ tools: allTools({ docker: false }) }) }) })
    await walkToStack(user)
    const compose = await screen.findByRole('button', { name: /Docker Compose/ })
    expect(compose).toBeDisabled()
    expect(within(compose).getByText('docker not installed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Laravel/ })).toBeEnabled()
  })

  it('fills the site name and folder from the domain and checks the name on blur', async () => {
    const { user, api } = setup()
    await enterDomain(user)
    expect(api['createSite.checkName']).toHaveBeenCalledWith('conn-1', 'shop.example.com')
    expect(screen.getByLabelText('Site name')).toHaveValue('shop')
    expect(screen.getByLabelText('Folder')).toHaveValue('/var/www/shop')
    expect(await screen.findByText(/found in Cloudflare · name is free/)).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    await user.type(screen.getByLabelText('Repository'), 'git@github.com:acme/shop.git')
    expect(continueButton()).toBeEnabled()
  })

  it('blocks Next when the name already has DNS records', async () => {
    const taken = { ...FREE_NAME, records: [{ type: 'A', name: 'shop.example.com', content: '198.51.100.7' }] }
    const { user } = setup({ 'createSite.checkName': vi.fn().mockResolvedValue({ success: true, data: taken }) })
    await enterDomain(user)
    expect(await screen.findByRole('status')).toHaveTextContent('shop.example.com already has DNS records that point somewhere else (A shop.example.com → 198.51.100.7)')
    expect(continueButton()).toBeDisabled()
  })

  it('keeps a record that already points at this server and lets the user go on', async () => {
    const pointing = { ...FREE_NAME, records: [{ type: 'A', name: 'shop.example.com', content: '203.0.113.10' }] }
    const { user } = setup({ 'createSite.checkName': vi.fn().mockResolvedValue({ success: true, data: pointing }) })
    await enterDomain(user)
    expect(await screen.findByRole('status')).toHaveTextContent('Already points at this server (A shop.example.com → 203.0.113.10) · kept as it is')
    await user.type(screen.getByLabelText('Repository'), 'git@github.com:acme/shop.git')
    expect(continueButton()).toBeEnabled()
  })

  it('adds www by default only to a bare domain, and keeps what the user chose', async () => {
    const { user } = setup()
    const www = () => screen.getByRole('switch', { name: /Also www/ })
    await enterDomain(user)
    expect(www()).not.toBeChecked()
    await user.clear(screen.getByLabelText('Domain'))
    await enterDomain(user, 'example.com')
    expect(www()).toBeChecked()
    await user.click(www())
    await user.clear(screen.getByLabelText('Domain'))
    await enterDomain(user, 'shop.com')
    expect(www()).not.toBeChecked()
  })

  it('adds www to a bare domain Cloudflare knows, even with a two-part ending', async () => {
    const zone = { ...FREE_NAME, zone: { id: 'zone-2', name: 'example.co.uk' } }
    const { user } = setup({ 'createSite.checkName': vi.fn().mockResolvedValue({ success: true, data: zone }) })
    await enterDomain(user, 'example.co.uk')
    await waitFor(() => expect(screen.getByRole('switch', { name: /Also www/ })).toBeChecked())
  })

  it('warns that a proxied name two levels under the zone fails at Cloudflare', async () => {
    const { user } = setup()
    await enterDomain(user)
    await user.click(screen.getByRole('switch', { name: /Also www/ }))
    await user.type(screen.getByLabelText('Repository'), 'git@github.com:acme/shop.git')
    await waitFor(() => expect(continueButton()).toBeEnabled())
    await user.click(continueButton())
    await user.click(continueButton())
    await user.click(continueButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Cloudflare\'s free certificate covers example.com and names one level under it. www.shop.example.com would fail through the proxy.')
    await user.click(screen.getByRole('switch', { name: /Proxy through Cloudflare/ }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('blocks Next when the name is already served by a site file', async () => {
    const served = { ...FREE_NAME, servedBy: '/etc/nginx/sites-enabled/old.conf' }
    const { user } = setup({ 'createSite.checkName': vi.fn().mockResolvedValue({ success: true, data: served }) })
    await enterDomain(user)
    expect(await screen.findByText(/Already served by/)).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
  })
})

describe('Create site, deploy commands', () => {
  it('lets the user change a command and reset to the stack defaults', async () => {
    const { user, api } = setup()
    await walkToStack(user)
    await user.click(continueButton())
    const migrate = await screen.findByDisplayValue('php8.3 artisan migrate --force')
    await user.clear(migrate)
    await user.type(migrate, 'php8.3 artisan migrate --force --seed')
    await user.click(screen.getByRole('button', { name: /Reset to the defaults/ }))
    expect(screen.getByDisplayValue('php8.3 artisan migrate --force')).toBeInTheDocument()
    const reset = screen.getByDisplayValue('php8.3 artisan migrate --force')
    await user.clear(reset)
    await user.type(reset, 'php8.3 artisan migrate --force --seed')
    await user.click(continueButton())
    await screen.findByDisplayValue('admin@example.com')
    await user.click(continueButton())
    await user.click(screen.getByRole('button', { name: /Create site/ }))
    expect(api['createSite.start'].mock.calls[0][2].activateSteps[0].command).toBe('php8.3 artisan migrate --force --seed')
  })
})

describe('Create site, database and environment', () => {
  it('shows the values Shellway sets with secrets hidden, and sends the user settings apart from the site', async () => {
    const { user, api } = setup()
    await walkToStack(user)
    await user.click(continueButton())
    const list = await screen.findByLabelText('Set by Shellway')
    expect(within(list).getByText('APP_URL')).toBeInTheDocument()
    expect(within(list).getByText('https://shop.example.com')).toBeInTheDocument()
    expect(within(list).getAllByText('••••')).toHaveLength(2)
    await user.type(screen.getByLabelText('Your settings'), 'MAIL_MAILER=smtp')
    await user.click(continueButton())
    await screen.findByDisplayValue('admin@example.com')
    await user.click(continueButton())
    await user.click(screen.getByRole('button', { name: /Create site/ }))
    const [, , input, secrets] = api['createSite.start'].mock.calls[0]
    expect(secrets.envText).toBe('MAIL_MAILER=smtp')
    expect(JSON.stringify(input)).not.toContain('MAIL_MAILER')
  })

  it('lets the user pick SQLite or no database', async () => {
    const { user, api } = setup()
    await walkToStack(user)
    await user.click(continueButton())
    await user.click(await screen.findByRole('button', { name: /^SQLite/ }))
    await user.click(continueButton())
    await screen.findByDisplayValue('admin@example.com')
    await user.click(continueButton())
    await user.click(screen.getByRole('button', { name: /Create site/ }))
    const [, , input, secrets] = api['createSite.start'].mock.calls[0]
    expect(input.database).toEqual({ engine: 'sqlite', path: '/var/www/shop-deploy/shared/database.sqlite' })
    expect(secrets.dbPassword).toBeNull()
  })
})

describe('Create site, stack from the repository', () => {
  it('reads the repository on this PC and says why it picked the stack', async () => {
    const { user, api } = setup()
    await walkToStack(user)
    expect(api['createSite.inspectRepo']).toHaveBeenCalledWith('git@github.com:acme/shop.git', 'main')
    expect(await screen.findByText(/Laravel matches the repository. It has an artisan file./)).toBeInTheDocument()
  })

  it('switches to the stack the repository shows, with its build output', async () => {
    const vite = { files: ['package.json', 'index.html'], packageJson: '{"scripts":{"build":"vite build"},"devDependencies":{"vite":"5"}}', composerJson: null, envExample: 'VITE_API=https://api.example.com\n' }
    const { user } = setup({ 'createSite.inspectRepo': vi.fn().mockResolvedValue({ success: true, data: vite }) })
    await walkToStack(user)
    expect(await screen.findByText(/Static site matches the repository/)).toBeInTheDocument()
    expect(screen.getByLabelText('Build output folder')).toHaveValue('dist')
  })

  it('never changes a stack the user picked; it offers the suggestion instead', async () => {
    const reading = deferred<{ success: boolean; data: unknown }>()
    const { user } = setup({ 'createSite.inspectRepo': vi.fn(() => reading.promise) })
    await walkToStack(user)
    await user.click(await screen.findByRole('button', { name: /^Node.js/ }))
    reading.resolve({ success: true, data: LARAVEL_REPO })
    expect(await screen.findByText(/The repository looks like Laravel/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Node.js/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Use Laravel' }))
    expect(screen.getByRole('button', { name: /^Laravel/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the stack the user went on with when the repository read finishes late', async () => {
    const reading = deferred<{ success: boolean; data: unknown }>()
    const vite = { files: ['package.json', 'index.html'], packageJson: '{"scripts":{"build":"vite build"}}', composerJson: null, envExample: null }
    const { user, api } = setup({ 'createSite.inspectRepo': vi.fn(() => reading.promise) })
    await walkToStack(user)
    await user.click(continueButton())
    reading.resolve({ success: true, data: vite })
    expect(await screen.findByDisplayValue('php8.3 artisan migrate --force')).toBeInTheDocument()
    await user.click(continueButton())
    await screen.findByDisplayValue('admin@example.com')
    await user.click(continueButton())
    await user.click(screen.getByRole('button', { name: /Create site/ }))
    expect(api['createSite.start'].mock.calls[0][2].template).toBe('laravel')
  })

  it('lets the user pick the stack when the repository cannot be read from this PC', async () => {
    const { user } = setup({ 'createSite.inspectRepo': vi.fn().mockResolvedValue({ success: false, error: 'Permission denied (publickey).' }) })
    await walkToStack(user)
    expect(await screen.findByText(/Could not read the repository from this PC/)).toBeInTheDocument()
    expect(continueButton()).toBeEnabled()
  })
})

describe('Create site, static site', () => {
  it('builds with npm, serves the output folder and falls back to index.html', async () => {
    const { user, api } = setup()
    await walkToStack(user)
    await user.click(await screen.findByRole('button', { name: /^Static site/ }))
    await user.click(screen.getByRole('button', { name: /^Built with npm/ }))
    expect(screen.getByLabelText('Build output folder')).toHaveValue('dist')
    await user.click(screen.getByRole('switch', { name: /Single-page app/ }))
    await user.click(continueButton())
    expect(await screen.findByDisplayValue('npm run build')).toBeInTheDocument()
    await user.click(continueButton())
    await screen.findByDisplayValue('admin@example.com')
    await user.click(continueButton())
    await user.click(screen.getByRole('button', { name: /Create site/ }))
    const [, , input] = api['createSite.start'].mock.calls[0]
    expect(input).toMatchObject({ template: 'static', buildOutput: 'dist', spa: true })
    expect(input.buildSteps.map((step: { command: string }) => step.command)).toEqual(['npm ci', 'npm run build'])
  })
})

describe('Create site, Laravel scheduler and queue', () => {
  it('lets the user turn off the queue worker', async () => {
    const { user, api } = setup()
    await walkToStack(user)
    await user.click(continueButton())
    expect(await screen.findByRole('switch', { name: /schedule:run every minute/ })).toBeChecked()
    await user.click(screen.getByRole('switch', { name: /queue worker/ }))
    await user.click(continueButton())
    await screen.findByDisplayValue('admin@example.com')
    await user.click(continueButton())
    await user.click(screen.getByRole('button', { name: /Create site/ }))
    const [, , input] = api['createSite.start'].mock.calls[0]
    expect(input.jobs).toEqual({ scheduler: true, queueWorker: false })
  })

  it('says why the worker is off on a server without systemd', async () => {
    const { user } = setup({ 'createSite.context': vi.fn().mockResolvedValue({ success: true, data: makeContext({ tools: allTools({ systemd: false }) }) }) })
    await walkToStack(user)
    await user.click(continueButton())
    const worker = await screen.findByRole('switch', { name: /queue worker/ })
    expect(worker).toBeDisabled()
    expect(worker).not.toBeChecked()
    expect(screen.getByText(/does not run systemd/)).toBeInTheDocument()
  })
})

describe('Create site, from domain to start', () => {
  it('walks every step and starts the run with the input the plan was built from', async () => {
    const { user, api } = setup()
    await walkToStack(user)
    await user.click(continueButton())
    expect(await screen.findByDisplayValue('php8.3 artisan migrate --force')).toBeInTheDocument()
    await user.click(continueButton())

    expect(await screen.findByDisplayValue('admin@example.com')).toBeInTheDocument()
    expect(screen.getByText(/Created in Cloudflare zone/)).toBeInTheDocument()
    await user.click(continueButton())

    const plan = screen.getByRole('list', { name: 'Plan' })
    expect(within(plan).getAllByRole('region').map((card) => card.getAttribute('aria-label'))).toEqual(
      ['Folder', 'PHP pool', 'nginx site', 'Database', 'DNS record', 'HTTPS', 'Deploys', 'Environment file', 'First deploy and check', 'Scheduler and queue']
    )
    expect(screen.getByText(/needs full sudo · available/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Create site/ }))
    expect(api['createSite.start']).toHaveBeenCalledTimes(1)
    const [connectionId, sessionId, input] = api['createSite.start'].mock.calls[0]
    expect([connectionId, sessionId]).toEqual(['conn-1', 'session-1'])
    expect(input).toMatchObject({
      domain: 'shop.example.com',
      siteName: 'shop',
      folder: '/var/www/shop',
      template: 'laravel',
      dns: { zoneId: 'zone-1', zoneName: 'example.com', serverIp: '203.0.113.10', proxied: true },
      https: { email: 'admin@example.com', redirect: true, staging: true }
    })
    expect(input.activateSteps[0].command).toBe('php8.3 artisan migrate --force')
    expect(input.database).toEqual({ engine: 'mysql', name: 'shop', user: 'shop' })
    expect(input.jobs).toEqual({ scheduler: true, queueWorker: true })
    const secrets = api['createSite.start'].mock.calls[0][3]
    expect(secrets.dbPassword).toMatch(/^(?=.*_)(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])[A-Za-z0-9_]{24}$/)
    expect(secrets.appKey).toMatch(/^base64:[A-Za-z0-9+/]{43}=$/)
    expect(JSON.stringify(input)).not.toContain(secrets.dbPassword)
    expect(await screen.findByRole('heading', { name: 'Creating shop.example.com' })).toBeInTheDocument()
  })

  it('creates the DNS record by hand when the token cannot edit DNS', async () => {
    const { user, api } = setup({ 'createSite.context': vi.fn().mockResolvedValue({ success: true, data: makeContext({ dnsEdit: false }) }) })
    await walkToStack(user)
    await user.click(continueButton())
    await user.click(continueButton())
    expect(await screen.findByText(/cannot create DNS records/)).toBeInTheDocument()
    await user.click(continueButton())
    await user.click(screen.getByRole('button', { name: /Create site/ }))
    expect(api['createSite.start'].mock.calls[0][2].dns).toEqual({ zoneId: null, zoneName: null, serverIp: '203.0.113.10', proxied: false })
  })

  it('holds Create while a step is blocked, until a fresh check clears it', async () => {
    const rhel = { server: { kind: 'apache', layout: 'rhel' } } as const
    const context = vi.fn()
      .mockResolvedValueOnce({ success: true, data: makeContext({ ...rhel, tools: allTools({ apacheModules: ['rewrite'] }) }) })
      .mockResolvedValueOnce({ success: true, data: makeContext(rhel) })
    const { user } = setup({ 'createSite.context': context })
    await walkToReview(user)
    expect(screen.getByRole('region', { name: 'Apache modules' })).toHaveTextContent('blocked')
    expect(screen.getByRole('button', { name: /Create site/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Create site/ })).toBeEnabled())
    expect(screen.queryByRole('region', { name: 'Apache modules' })).not.toBeInTheDocument()
  })
})

describe('Create site, code source', () => {
  const planCards = () => within(screen.getByRole('list', { name: 'Plan' })).getAllByRole('region').map((card) => card.getAttribute('aria-label'))

  async function walkThroughToCreate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(continueButton())
    await user.click(continueButton())
    await screen.findByDisplayValue('admin@example.com')
    await user.click(continueButton())
  }

  it('starts a new project in a new private GitHub repository and keeps a copy on this PC', async () => {
    const { user, api } = setup()
    await enterDomain(user)
    await user.click(screen.getByRole('button', { name: /Start a new project/ }))
    expect(await screen.findByText(/Creates github.com\/acme\/shop/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Folder on this PC'), '/home/dev/Projects')
    await waitFor(() => expect(api['createSite.checkProject']).toHaveBeenCalledWith({ repo: { kind: 'github', owner: 'acme', name: 'shop', private: true }, repoUrl: 'git@github.com:acme/shop.git', localParent: '/home/dev/Projects', siteName: 'shop' }))
    await waitFor(() => expect(continueButton()).toBeEnabled())
    await user.click(continueButton())
    expect(await screen.findByRole('button', { name: /Docker Compose/ })).toBeDisabled()
    expect(api['createSite.inspectRepo']).not.toHaveBeenCalled()
    await walkThroughToCreate(user)
    expect(planCards().slice(0, 2)).toEqual(['Repository', 'New project'])
    await user.click(screen.getByRole('button', { name: /Create site/ }))
    const [, , input] = api['createSite.start'].mock.calls[0]
    expect(input).toMatchObject({
      codeSource: 'new',
      newRepo: { kind: 'github', owner: 'acme', name: 'shop', private: true },
      repoUrl: 'git@github.com:acme/shop.git',
      localParent: '/home/dev/Projects',
      template: 'laravel'
    })
  })

  it('holds Continue while the new project check finds a problem', async () => {
    const { user } = setup({ 'createSite.checkProject': vi.fn().mockResolvedValue({ success: true, data: 'github.com/acme/shop already exists and has commits.' }) })
    await enterDomain(user)
    await user.click(screen.getByRole('button', { name: /Start a new project/ }))
    await user.type(await screen.findByLabelText('Folder on this PC'), '/home/dev/Projects')
    expect(await screen.findByText('github.com/acme/shop already exists and has commits.')).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check the repository and folder again' })).toBeInTheDocument()
  })

  it('asks for a GitHub token when none is saved', async () => {
    const { user } = setup({ 'createSite.githubAccount': vi.fn().mockResolvedValue({ success: true, data: null }) })
    await enterDomain(user)
    await user.click(screen.getByRole('button', { name: /Start a new project/ }))
    expect(await screen.findByText(/No GitHub token is saved/)).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
  })

  it('makes a site with no code yet: a placeholder page, the site, DNS and HTTPS only', async () => {
    const { user, api } = setup()
    await enterDomain(user)
    await user.click(screen.getByRole('button', { name: /No code yet/ }))
    await waitFor(() => expect(continueButton()).toBeEnabled())
    const setsUp = screen.getByRole('region', { name: 'Shellway will set up' })
    expect(within(setsUp).getByText('Folder with a placeholder page')).toBeInTheDocument()
    expect(within(setsUp).queryByText(/deploy/)).toBeNull()
    await user.click(continueButton())
    expect(screen.getByText('shop.example.com · no code yet')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /^Laravel/ })).toBeDisabled()
    await user.click(continueButton())
    expect(await screen.findByText(/A site without code has no deploys/)).toBeInTheDocument()
    await user.click(continueButton())
    await screen.findByDisplayValue('admin@example.com')
    await user.click(continueButton())
    expect(planCards()).toEqual(['Folder', 'nginx site', 'DNS record', 'HTTPS'])
    await user.click(screen.getByRole('button', { name: /Create site/ }))
    const [, , input, secrets] = api['createSite.start'].mock.calls[0]
    expect(input).toMatchObject({ codeSource: 'none', template: 'static', repoUrl: '', database: null, env: false, buildSteps: [], activateSteps: [] })
    expect(secrets).toMatchObject({ dbPassword: null, appKey: null })
  })
})
