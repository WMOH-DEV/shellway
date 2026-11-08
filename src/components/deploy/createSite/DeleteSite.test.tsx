import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Leftover, RunRecord } from '@/types/createSite'
import { CreateSiteWizard } from './CreateSiteWizard'
import { NO_RESOURCES, SITE_SHA, fakeBackend, makeRun, runStep } from './testRun'

const FINISHED = makeRun({
  phase: 'done',
  current: null,
  error: null,
  machineId: '0123456789abcdef0123456789abcdef',
  steps: [runStep('folder', 'done', 1, 2), runStep('site', 'done', 2, 3), runStep('first-deploy', 'done', 3, 4)],
  created: {
    ...NO_RESOURCES,
    folder: { path: '/var/www/shop', createdByRun: true },
    siteFile: { path: '/etc/nginx/sites-available/shop.conf', enabledLink: '/etc/nginx/sites-enabled/shop.conf', sha256: SITE_SHA },
    database: { engine: 'mysql', name: 'shop', user: 'shop' },
    deploySite: 'shop'
  }
})

const MEASURED: Leftover[] = [
  { id: 'folder', title: 'The site folder /var/www/shop-deploy with every release, uploaded files and the .env file, and the link /var/www/shop', command: "sudo rm -rf '/var/www/shop-deploy' '/var/www/shop'", size: '84M' },
  { id: 'database', title: 'The MySQL database shop with every table and row, and its user shop', command: "sudo mysql <<'SQL'\nDROP DATABASE IF EXISTS `shop`;\nSQL", size: '12.5M' }
]

const confirmButton = () => screen.getAllByRole('button', { name: 'Delete site' }).at(-1) as HTMLElement

function setup(record: RunRecord, openDelete = true, overrides: Record<string, unknown> = {}) {
  const backend = fakeBackend({
    'createSite.leftovers': vi.fn().mockResolvedValue({ success: true, data: MEASURED }),
    'createSite.deleteSite': vi.fn().mockResolvedValue({ success: true, data: { ...record, phase: 'removing', deleting: true } }),
    ...overrides
  })
  render(<CreateSiteWizard connectionId="conn-1" sessionId="session-1" serverName="Test server" initialRun={record} openDelete={openDelete} onClose={vi.fn()} />)
  return { ...backend, user: userEvent.setup() }
}

describe('Deleting a site Create site made', () => {
  it('lists what is removed and what is kept with sizes, and deletes only after the site name is typed', async () => {
    const { user, api } = setup(FINISHED)
    const removed = screen.getByRole('list', { name: 'Will be removed' })
    expect(removed).toHaveTextContent('Deploy site shop: automatic deploys stop')
    expect(removed).toHaveTextContent('nginx site /etc/nginx/sites-available/shop.conf, if unchanged')
    expect(removed).not.toHaveTextContent('DROP')
    const kept = screen.getByRole('list', { name: 'Will be kept' })
    expect(await within(kept).findByText('(84M)')).toBeInTheDocument()
    expect(within(kept).getByText('(12.5M)')).toBeInTheDocument()
    expect(within(kept).getByLabelText(/Delete by hand: The site folder/)).toHaveTextContent("sudo rm -rf '/var/www/shop-deploy' '/var/www/shop'")
    expect(api['createSite.leftovers']).toHaveBeenCalledWith('conn-1', 'run-1')
    const confirm = confirmButton()
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText('Type shop to confirm'), 'sho')
    expect(confirm).toBeDisabled()
    await user.type(screen.getByLabelText('Type shop to confirm'), 'p')
    await user.click(confirm)
    expect(api['createSite.deleteSite']).toHaveBeenCalledWith('conn-1', 'run-1', 'shop')
    expect(await screen.findByText('Deleting shop.example.com…')).toBeInTheDocument()
  })

  it('still lists what is kept when the sizes cannot be read', async () => {
    setup(FINISHED, true, { 'createSite.leftovers': vi.fn().mockResolvedValue({ success: false, error: 'Not connected' }) })
    const kept = screen.getByRole('list', { name: 'Will be kept' })
    expect(kept).toHaveTextContent('The MySQL database shop')
    expect(await screen.findByLabelText('Type shop to confirm')).toBeInTheDocument()
    expect(within(kept).queryByText('(84M)')).not.toBeInTheDocument()
  })

  it('offers Delete site on a finished run without opening the dialog by itself', async () => {
    const { user } = setup(FINISHED, false)
    expect(screen.queryByText('Delete shop.example.com?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Delete site/ }))
    expect(screen.getByText('Delete shop.example.com?')).toBeInTheDocument()
  })

  it('shows what was left in place and how to delete the rest once deleted', () => {
    setup({ ...FINISHED, phase: 'removed', deleting: true, kept: ['/etc/nginx/sites-available/shop.conf changed after Shellway wrote it. It was left in place.'] }, false)
    expect(screen.getByRole('heading', { name: 'Deleting shop.example.com' })).toBeInTheDocument()
    expect(screen.getByText('Deleted')).toBeInTheDocument()
    expect(screen.getByText(/is deleted\. Its files and data stay/)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Left in place' })).toHaveTextContent('shop.conf changed after Shellway wrote it')
    expect(screen.getByRole('list', { name: 'Will be kept' })).toHaveTextContent("sudo rm -rf '/var/www/shop-deploy' '/var/www/shop'")
  })

  it('asks for the site name again when a failed delete is retried', async () => {
    const { user, api } = setup({ ...FINISHED, phase: 'remove-failed', deleting: true, error: 'nginx site was not removed: nginx rejected the configuration' }, false)
    expect(screen.getByText('Delete failed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Try removing again/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try deleting again/ }))
    expect(confirmButton()).toBeDisabled()
    await user.type(screen.getByLabelText('Type shop to confirm'), 'shop')
    await user.click(confirmButton())
    expect(api['createSite.deleteSite']).toHaveBeenCalledWith('conn-1', 'run-1', 'shop')
  })

  it('never opens the delete dialog for a run that did not finish', () => {
    setup(makeRun())
    expect(screen.queryByText(/^Delete shop\.example\.com\?$/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete site/ })).not.toBeInTheDocument()
  })

  it('does not offer Delete for a site made before Shellway recorded its server', () => {
    setup({ ...FINISHED, machineId: undefined })
    expect(screen.queryByText('Delete shop.example.com?')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete site/ })).not.toBeInTheDocument()
  })
})
