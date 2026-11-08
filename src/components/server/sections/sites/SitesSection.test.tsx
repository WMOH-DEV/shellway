import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerRoute } from '@/types/server/core'
import { makeRecord, makeSummary } from '@/utils/deploy/testSummary'
import { INVENTORY_PROBE } from '@/utils/server/sites/inventory'
import { makeInventory } from '@/utils/server/sites/fixtures/inventory'
import { makeBlock, makeHost, makeReport, originExpiringIn } from '@/utils/ssl/testReport'
import type { ServerSectionContext } from '../types'
import { SitesSection } from './SitesSection'

const launch = vi.fn()
vi.mock('../../action', () => ({ useActionLauncher: () => ({ launch }) }))
vi.mock('@/components/deploy/EnvEditor', () => ({ EnvEditor: () => null }))
vi.mock('@/components/deploy/createSite/CreateSiteWizard', () => ({
  CreateSiteWizard: ({ onClose }: { onClose: () => void }) => <button type="button" onClick={onClose}>Close Create site</button>
}))

const app = makeSummary({
  config: { name: 'app', path: '/var/www/app', healthUrl: 'https://app.example.com/up', activateSteps: [{ command: 'php artisan migrate --force', optional: false, timeoutSeconds: null }] },
  state: { currentSubject: 'Add invoice export' },
  history: [makeRecord({ id: 'd1', subject: 'Add invoice export' })]
})

const report = makeReport({
  blocks: [
    makeBlock({ id: 'app:9', file: '/etc/nginx/sites-enabled/app', root: '/var/www/app/current/public', names: ['app.example.com'] }),
    makeBlock({ id: 'mail:1', file: '/etc/nginx/sites-enabled/mail', root: '/srv/mail', names: ['mail.example.com'] })
  ],
  hostnames: [
    makeHost({ name: 'app.example.com', blockId: 'app:9', verdict: 'will-break', origin: originExpiringIn(-1), reason: 'Expired' }),
    makeHost({ name: 'mail.example.com', blockId: 'mail:1' })
  ]
})

const inventory = makeInventory({
  vhosts: [{ path: '/etc/nginx/sites-enabled/app', realPath: '/etc/nginx/sites-available/app', sha256: 'a'.repeat(64), content: 'root /var/www/app/current/public;\nfastcgi_pass unix:/run/php/php8.3-fpm.sock;\n' }]
})

const ok = <T,>(data: T) => Promise.resolve({ success: true as const, data })
const off = () => () => {}

const sslCheck = vi.fn(() => ok(report))

function installApi() {
  const tail = vi.fn(() => ok({ state: 'ok', text: '[2026-11-07] production.ERROR: boom\n' }))
  Object.assign(window, {
    novadeck: {
      deploy: {
        runnerInfo: () => ok({ installed: true, version: 3, bundledVersion: 3 }),
        list: () => ok([app]),
        drift: () => ok(null),
        onChanged: off,
        onFinished: off,
        doctor: () => ok(null),
        webServerCheck: () => ok(null)
      },
      ssl: { check: sslCheck, lastReport: () => ok(report) },
      createSite: { runs: () => ok([]) },
      server: {
        scan: () => ok({ [INVENTORY_PROBE]: { status: 'ok', data: inventory, at: 1 } }),
        facts: () => ok({}),
        onFacts: off,
        sites: { tail }
      }
    }
  })
  return tail
}

function renderSection(route: ServerRoute) {
  const navigate = vi.fn()
  const ctx: ServerSectionContext = {
    tabId: 't1',
    connectionId: 'c1',
    sessionId: 's1',
    sessionName: 'Test server',
    connectionStatus: 'connected',
    route,
    active: true,
    navigate
  }
  render(<SitesSection ctx={ctx} />)
  return { navigate, user: userEvent.setup() }
}

describe('Sites section', () => {
  beforeEach(() => launch.mockClear())

  it('joins deploy sites with their HTTPS state and keeps other hostnames apart', async () => {
    installApi()
    const { navigate, user } = renderSection({ section: 'sites' })
    const row = (await screen.findByText('app.example.com')).closest('[role="row"]') as HTMLElement
    expect(within(row).getByText('Laravel')).toBeInTheDocument()
    expect(within(row).getByText('Add invoice export')).toBeInTheDocument()
    expect(await within(row).findByText('PHP 8.3 · nginx')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Fix HTTPS' }))
    expect(navigate).toHaveBeenCalledWith({ section: 'sites', sub: 'site', params: { site: 'app', tab: 'domains' } })
    expect(screen.getByRole('region', { name: 'Other hostnames' })).toHaveTextContent('mail.example.com')
  })

  it('opens the site detail with its tabs and tails the app log', async () => {
    const tail = installApi()
    renderSection({ section: 'sites', sub: 'site', params: { site: 'app' } })
    expect(await screen.findByRole('heading', { name: 'app.example.com' })).toBeInTheDocument()
    const tabs = screen.getByRole('tablist', { name: 'Site sections' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Overview', 'Deployments', 'Pipeline', 'Domains & HTTPS', 'Environment', 'Workers & cron', 'Logs', 'Commands', 'Settings'])
    expect(within(tabs).getByRole('tab', { name: /Domains & HTTPS/ })).toContainElement(screen.getByLabelText('has a problem'))
    await waitFor(() => expect(tail).toHaveBeenCalledWith('c1', { site: 'app', source: 'app', file: 'storage/logs/laravel.log', lines: 8 }))
    expect(await screen.findByText('[2026-11-07] production.ERROR: boom')).toBeInTheDocument()
  })

  it('checks HTTPS again when Create site closes, so a new site shows its certificate', async () => {
    installApi()
    const { user } = renderSection({ section: 'sites', sub: 'create' })
    await waitFor(() => expect(sslCheck).toHaveBeenCalled())
    const before = sslCheck.mock.calls.length
    await user.click(await screen.findByRole('button', { name: 'Close Create site' }))
    await waitFor(() => expect(sslCheck.mock.calls.length).toBeGreaterThan(before))
  })

  it('runs a preset command through the action engine', async () => {
    installApi()
    const { user } = renderSection({ section: 'sites', sub: 'site', params: { site: 'app', tab: 'commands' } })
    await user.click(await screen.findByRole('button', { name: /Maintenance mode on/ }))
    expect(launch).toHaveBeenCalledWith({ type: 'sites.command', params: { site: 'app', command: 'php artisan down' } })
    expect(screen.getByRole('region', { name: 'Recent' })).toHaveTextContent('php artisan down')
  })
})
