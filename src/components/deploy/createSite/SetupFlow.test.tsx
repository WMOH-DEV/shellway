import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { allTools } from '@/utils/createSite/testFixtures'
import { CreateSiteWizard } from './CreateSiteWizard'
import { FREE_NAME, fakeBackend, makeContext } from './testRun'

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

async function walkToReview(user: ReturnType<typeof userEvent.setup>) {
  await enterDomain(user)
  await waitFor(() => expect(continueButton()).toBeEnabled())
  await user.click(continueButton())
  await user.type(screen.getByLabelText('Repository'), 'git@github.com:acme/shop.git')
  await user.click(continueButton())
  await screen.findByDisplayValue('admin@example.com')
  await user.click(continueButton())
}

describe('Create site, step 1', () => {
  it('disables a template the server cannot run and says why', async () => {
    setup({ 'createSite.context': vi.fn().mockResolvedValue({ success: true, data: makeContext({ tools: allTools({ docker: false }) }) }) })
    const compose = await screen.findByRole('button', { name: /Docker Compose/ })
    expect(compose).toBeDisabled()
    expect(within(compose).getByText('docker not installed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Laravel/ })).toBeEnabled()
  })

  it('fills the site name and folder from the domain and checks the name on blur', async () => {
    const { user, api } = setup()
    await enterDomain(user)
    expect(api['createSite.checkName']).toHaveBeenCalledWith('conn-1', 'shop.example.com')
    expect(screen.getByLabelText('Site name')).toHaveValue('shop')
    expect(screen.getByLabelText('Folder')).toHaveValue('/var/www/shop')
    expect(await screen.findByText(/found in Cloudflare · name is free/)).toBeInTheDocument()
    expect(continueButton()).toBeEnabled()
  })

  it('blocks Next when the name already has DNS records', async () => {
    const taken = { ...FREE_NAME, records: [{ type: 'A', name: 'shop.example.com', content: '198.51.100.7' }] }
    const { user } = setup({ 'createSite.checkName': vi.fn().mockResolvedValue({ success: true, data: taken }) })
    await enterDomain(user)
    expect(await screen.findByRole('status')).toHaveTextContent('shop.example.com already has DNS records (A 198.51.100.7)')
    expect(continueButton()).toBeDisabled()
  })

  it('blocks Next when the name is already served by a site file', async () => {
    const served = { ...FREE_NAME, servedBy: '/etc/nginx/sites-enabled/old.conf' }
    const { user } = setup({ 'createSite.checkName': vi.fn().mockResolvedValue({ success: true, data: served }) })
    await enterDomain(user)
    expect(await screen.findByText(/Already served by/)).toBeInTheDocument()
    expect(continueButton()).toBeDisabled()
  })
})

describe('Create site, from domain to start', () => {
  it('walks every step and starts the run with the input the plan was built from', async () => {
    const { user, api } = setup()
    await enterDomain(user)
    await waitFor(() => expect(continueButton()).toBeEnabled())
    await user.click(continueButton())

    await user.type(screen.getByLabelText('Repository'), 'git@github.com:acme/shop.git')
    await user.click(continueButton())

    expect(await screen.findByDisplayValue('admin@example.com')).toBeInTheDocument()
    expect(screen.getByText(/Created in Cloudflare zone/)).toBeInTheDocument()
    await user.click(continueButton())

    const plan = screen.getByRole('list', { name: 'Plan' })
    expect(within(plan).getAllByRole('region').map((card) => card.getAttribute('aria-label'))).toEqual(
      ['Folder', 'nginx site', 'DNS record', 'HTTPS', 'Deploys', 'First deploy and check']
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
    expect(await screen.findByRole('heading', { name: 'Creating shop.example.com' })).toBeInTheDocument()
  })

  it('creates the DNS record by hand when the token cannot edit DNS', async () => {
    const { user, api } = setup({ 'createSite.context': vi.fn().mockResolvedValue({ success: true, data: makeContext({ dnsEdit: false }) }) })
    await enterDomain(user)
    await waitFor(() => expect(continueButton()).toBeEnabled())
    await user.click(continueButton())
    await user.type(screen.getByLabelText('Repository'), 'git@github.com:acme/shop.git')
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
