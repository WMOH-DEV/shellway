import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RunRecord } from '@/types/createSite'
import { CreateSiteWizard } from './CreateSiteWizard'
import { SITE_SHA, fakeBackend, makeRun, runStep } from './testRun'

function setup(record: RunRecord, overrides: Record<string, unknown> = {}) {
  const backend = fakeBackend(overrides)
  const onClose = vi.fn()
  render(<CreateSiteWizard connectionId="conn-1" sessionId="session-1" serverName="Test server" initialRun={record} onClose={onClose} />)
  return { ...backend, onClose, user: userEvent.setup() }
}

const progress = () => within(screen.getByRole('list', { name: 'Progress' }))

describe('Create site run screen', () => {
  it('shows done, failed and waiting steps from the run record', () => {
    setup(makeRun())
    expect(progress().getByRole('listitem', { name: 'Folder: Done' })).toHaveTextContent('1s')
    expect(progress().getByRole('listitem', { name: 'nginx site: Failed' })).toBeInTheDocument()
    expect(progress().getByRole('listitem', { name: 'DNS record: Waiting' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('nginx -t failed: unknown directive')
    expect(screen.getByText(/marks it as done by hand/)).toBeInTheDocument()
  })

  it('shows the current step as running, with Stop after this step', async () => {
    const { user, api } = setup(makeRun({ phase: 'running', error: null, steps: [runStep('folder', 'done', 1, 1_001), runStep('site', 'pending', 2_000), runStep('dns', 'pending')] }))
    expect(progress().getByRole('listitem', { name: 'nginx site: Running…' })).toBeInTheDocument()
    expect(screen.getByText('step 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open site/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Stop after this step' }))
    expect(api['createSite.stop']).toHaveBeenCalledWith('run-1')
    expect(screen.getByRole('button', { name: 'Stopping after this step…' })).toBeDisabled()
  })

  it('retries the failed step', async () => {
    const { user, api } = setup(makeRun())
    await user.click(screen.getByRole('button', { name: /Retry this step/ }))
    expect(api['createSite.resume']).toHaveBeenCalledWith('conn-1', 'run-1', 'retry')
    expect(await screen.findByRole('button', { name: 'Stop after this step' })).toBeInTheDocument()
  })

  it('continues from here after a fix by hand', async () => {
    const { user, api } = setup(makeRun({ phase: 'stopped', error: null }))
    await user.click(screen.getByRole('button', { name: /Continue from here/ }))
    expect(api['createSite.resume']).toHaveBeenCalledWith('conn-1', 'run-1', 'continue')
  })

  it('lists what will be removed before removing it', async () => {
    const record = makeRun({
      created: {
        folder: { path: '/var/www/shop', createdByRun: true },
        siteFile: { path: '/etc/nginx/sites-available/shop.conf', enabledLink: '/etc/nginx/sites-enabled/shop.conf', sha256: SITE_SHA },
        phpPool: null,
        modulesEnabled: [],
        dnsRecords: [{ zoneId: 'zone-1', recordId: 'rec-a', name: 'shop.example.com', type: 'A' }],
        httpsSiteFile: null,
        certificate: null,
        deploySite: null
      }
    })
    const { user, api } = setup(record)
    await user.click(screen.getByRole('button', { name: /Remove what this wizard created/ }))
    const list = await screen.findByRole('list', { name: 'Will be removed' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'DNS record A shop.example.com',
      'nginx site /etc/nginx/sites-available/shop.conf',
      'Folder /var/www/shop'
    ])
    expect(api['createSite.remove']).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(api['createSite.remove']).toHaveBeenCalledWith('conn-1', 'run-1')
    expect(await screen.findByText('Removing what this wizard created…')).toBeInTheDocument()
  })

  it('cancels removal from the confirmation without calling the server', async () => {
    const { user, api } = setup(makeRun())
    await user.click(screen.getByRole('button', { name: /Remove what this wizard created/ }))
    expect(await screen.findByText(/has not created anything yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api['createSite.remove']).not.toHaveBeenCalled()
  })

  it('shows output for this run only', async () => {
    const { emitOutput } = setup(makeRun({ phase: 'running', error: null }))
    act(() => {
      emitOutput({ runId: 'run-2', chunk: 'output from another run\n' })
      emitOutput({ runId: 'run-1', chunk: 'nginx: configuration file test is successful\n' })
    })
    expect(await screen.findByText('nginx: configuration file test is successful')).toBeInTheDocument()
    expect(screen.queryByText('output from another run')).not.toBeInTheDocument()
  })

  it('does not call the site live when a step was marked as done by hand', () => {
    setup(makeRun({ phase: 'done', error: null, current: null, steps: [runStep('folder', 'done', 1, 2), runStep('first-deploy', 'skipped', 3, 4)] }))
    expect(screen.getByText('shop.example.com is set up. 1 step was marked as done by hand, so check it before relying on the site.')).toBeInTheDocument()
    expect(screen.queryByText(/is live/)).toBeNull()
  })

  it('follows updates for this run and offers Open site when done', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const { emitUpdate, user } = setup(makeRun({ phase: 'running', error: null }))
    const done = makeRun({ phase: 'done', error: null, current: null, steps: [runStep('folder', 'done', 1, 1_001)] })
    act(() => {
      emitUpdate({ ...done, id: 'run-2', phase: 'failed' })
      emitUpdate(done)
    })
    expect(screen.getByText(/is live over HTTPS/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Open site/ }))
    expect(open).toHaveBeenCalledWith('https://shop.example.com', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('shows the deploy key with a copy button', () => {
    setup(makeRun({ phase: 'running', error: null, deployKey: 'ssh-ed25519 AAAAexample shellway-deploy' }))
    const card = screen.getByRole('region', { name: 'Deploy key' })
    expect(within(card).getByText('ssh-ed25519 AAAAexample shellway-deploy')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(within(card).getByText(/acme\/shop/)).toBeInTheDocument()
  })

  it('explains removal results', () => {
    setup(makeRun({ phase: 'remove-failed', error: 'certbot delete failed' }))
    expect(screen.getByRole('alert')).toHaveTextContent('certbot delete failed')
    expect(screen.getByRole('button', { name: /Try removing again/ })).toBeInTheDocument()
  })

  it('goes back to sites', async () => {
    const { user, onClose } = setup(makeRun({ phase: 'removed', error: null }))
    expect(screen.getByText(/Everything this wizard created is removed/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to sites' }))
    expect(onClose).toHaveBeenCalled()
  })
})
