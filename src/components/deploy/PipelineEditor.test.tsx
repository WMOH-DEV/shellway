import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/Toast'
import { mockNovadeck } from '@/test/novadeck'
import type { DeployStep, DoctorReport, SiteConfig } from '@/types/deploy'
import { blankStep } from '@/utils/deploy/pipelineSteps'
import { makeSummary } from '@/utils/deploy/testSummary'
import { PipelineEditor } from './PipelineEditor'

const doctor: DoctorReport = {
  user: 'deploy', git: true, curl: true, wget: false, crontab: true, sshKeygen: true, sitePathKind: 'symlink',
  parentWritable: true, siteWritable: true, deployKey: true, sudoOk: [], sudoNeeds: ['/usr/bin/systemctl reload php8.3-fpm']
}

const step = (command: string, extra: Partial<DeployStep> = {}): DeployStep => ({ ...blankStep(command), ...extra })

const summary = makeSummary({
  config: {
    name: 'example-app',
    path: '/home/deploy/www/example_app',
    repoUrl: 'git@example.com:acme/example-app.git',
    sharedPaths: ['.env', 'storage'],
    buildSteps: [step('npm ci'), step('npm run build', { timeoutSeconds: 900 })],
    activateSteps: [step('php artisan migrate --force'), step('sudo systemctl reload php8.3-fpm', { optional: true })]
  }
})

function setup(overrides: Record<string, unknown> = {}) {
  const save = vi.fn().mockResolvedValue({ success: true })
  mockNovadeck({
    'deploy.doctor': vi.fn().mockResolvedValue({ success: true, data: doctor }),
    'deploy.webServerCheck': vi.fn().mockResolvedValue({ success: true, data: null }),
    'deploy.save': save,
    ...overrides
  })
  const onSaved = vi.fn()
  const onOpenServerCheck = vi.fn()
  render(<PipelineEditor connectionId="conn-1" summary={summary} onSaved={onSaved} onOpenServerCheck={onOpenServerCheck} />)
  return { save, onSaved, onOpenServerCheck, user: userEvent.setup() }
}

async function chooseFromMenu(user: ReturnType<typeof userEvent.setup>, rowIndex: number, name: string): Promise<void> {
  await user.click(screen.getAllByRole('button', { name: 'Command options' })[rowIndex])
  await user.click(screen.getByRole('button', { name }))
  await waitFor(() => expect(screen.queryByRole('button', { name })).not.toBeInTheDocument())
}

const savedConfig = (save: ReturnType<typeof vi.fn>): SiteConfig => save.mock.calls[0][1]

describe('PipelineEditor', () => {
  it('shows every command in its stage with limits, modes and server details', async () => {
    setup()
    expect(screen.getByDisplayValue('npm ci')).toBeInTheDocument()
    expect(screen.getByDisplayValue('npm run build')).toBeInTheDocument()
    expect(screen.getByDisplayValue('php artisan migrate --force')).toBeInTheDocument()
    expect(screen.getByDisplayValue('15m')).toBeInTheDocument()
    expect(screen.getByText('Managed by Shellway')).toBeInTheDocument()
    expect(screen.getByText('ln -sfn releases/<new> current')).toBeInTheDocument()
    expect(await screen.findByText('deploy')).toBeInTheDocument()
    expect(await screen.findByText('needs sudoers line')).toBeInTheDocument()
    expect(screen.getByText('1 command needs a sudoers line')).toBeInTheDocument()
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save pipeline' })).toBeDisabled()
  })

  it('does not offer instant deploy on push', () => {
    setup()
    expect(screen.queryByText(/webhook/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/on push/i)).not.toBeInTheDocument()
  })

  it('counts edits, saves the draft and tells the parent', async () => {
    const { user, save, onSaved } = setup()
    const first = screen.getByLabelText('Build command 1')
    await user.clear(first)
    await user.type(first, 'npm install')
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument()
    expect(screen.getByText(/applies from the next deploy/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save pipeline' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    expect(save).toHaveBeenCalledWith('conn-1', expect.objectContaining({ name: 'example-app' }))
    expect(savedConfig(save).buildSteps[0].command).toBe('npm install')
    await waitFor(() => expect(screen.getByText('No unsaved changes')).toBeInTheDocument())
  })

  it('shows the server error and keeps the changes when saving fails', async () => {
    const errorToast = vi.spyOn(toast, 'error')
    const { user, onSaved } = setup({ 'deploy.save': vi.fn().mockResolvedValue({ success: false, error: 'Branch name is not valid' }) })
    await user.click(screen.getAllByRole('button', { name: 'Optional' })[0])
    await user.click(screen.getByRole('button', { name: 'Save pipeline' }))
    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Could not save the pipeline', 'Branch name is not valid'))
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument()
  })

  it('discards edits', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Optional' })[0])
    expect(screen.getByText('1 unsaved change')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
  })

  it('saves a typed time limit as seconds', async () => {
    const { user, save } = setup()
    const limit = screen.getAllByLabelText('Time limit')[0]
    await user.type(limit, '10m')
    await user.tab()
    await user.click(screen.getByRole('button', { name: 'Save pipeline' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(savedConfig(save).buildSteps[0].timeoutSeconds).toBe(600)
  })

  it('ignores a time limit it cannot read', async () => {
    const { user } = setup()
    const limit = screen.getAllByLabelText('Time limit')[0]
    await user.type(limit, 'soon')
    await user.tab()
    expect(limit).toHaveValue('')
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
  })

  it('adds, duplicates and deletes commands', async () => {
    const { user, save } = setup()
    await user.click(screen.getAllByRole('button', { name: /Add command/ })[0])
    await user.type(screen.getByLabelText('Build command 3'), 'npm test')
    await chooseFromMenu(user, 0, 'Duplicate')
    await chooseFromMenu(user, 1, 'Delete')
    await user.click(screen.getByRole('button', { name: 'Save pipeline' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(savedConfig(save).buildSteps.map((s) => s.command)).toEqual(['npm ci', 'npm run build', 'npm test'])
  })

  it('moves a command to the other stage', async () => {
    const { user, save } = setup()
    await chooseFromMenu(user, 0, 'Move to After going live')
    await user.click(screen.getByRole('button', { name: 'Save pipeline' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(savedConfig(save).buildSteps.map((s) => s.command)).toEqual(['npm run build'])
    expect(savedConfig(save).activateSteps.map((s) => s.command)).toEqual([
      'php artisan migrate --force', 'sudo systemctl reload php8.3-fpm', 'npm ci'
    ])
  })

  it('reorders commands by dragging the handle onto another row', async () => {
    const { user, save } = setup()
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' }
    const handle = screen.getAllByTitle('Drag to reorder')[0]
    const targetRow = screen.getByLabelText('Build command 2').closest('[data-step-row]')!
    fireEvent.dragStart(handle, { dataTransfer })
    fireEvent.dragOver(targetRow, { dataTransfer })
    fireEvent.drop(targetRow, { dataTransfer })
    await user.click(screen.getByRole('button', { name: 'Save pipeline' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(savedConfig(save).buildSteps.map((s) => s.command)).toEqual(['npm run build', 'npm ci'])
  })

  it('turns on quiet hours with a default overnight window', async () => {
    const { user, save } = setup()
    await user.click(within(screen.getByText('Quiet hours').closest('div')!.parentElement!).getByRole('switch'))
    expect(screen.getByText(/Server time/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save pipeline' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(savedConfig(save).quietHours).toBe('22:00-06:00')
  })

  it('detects the chat service from the notification url', async () => {
    const { user, save } = setup()
    await user.type(screen.getByLabelText('Notification URL'), 'https://hooks.slack.com/services/T0/B0/x')
    expect(screen.getByText('Sends a Slack message.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save pipeline' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(savedConfig(save).notifyUrl).toBe('https://hooks.slack.com/services/T0/B0/x')
  })

  it('blocks saving a notification address that is not http', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText('Notification URL'), 'hooks.example.com')
    expect(screen.getByText('Notification URL must start with http:// or https://')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save pipeline' })).toBeDisabled()
  })

  it('blocks saving an empty command', async () => {
    const { user } = setup()
    await user.clear(screen.getByLabelText('Build command 1'))
    expect(screen.getByText('A command is empty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save pipeline' })).toBeDisabled()
  })

  it('opens the server check from the sudo warning panel', async () => {
    const { user, onOpenServerCheck } = setup()
    await user.click(screen.getByRole('button', { name: 'Open server check' }))
    expect(onOpenServerCheck).toHaveBeenCalledOnce()
  })

  it('appends commands from a preset', async () => {
    const { user, save } = setup()
    await user.click(screen.getAllByRole('button', { name: 'From preset…' })[0])
    await user.click(screen.getByRole('button', { name: 'PHP' }))
    await user.click(screen.getByRole('button', { name: 'Save pipeline' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(savedConfig(save).buildSteps.map((s) => s.command)).toEqual([
      'npm ci', 'npm run build', 'composer install --no-dev --optimize-autoloader --no-interaction'
    ])
  })

  it('hides the switch-back toggle for in-place sites', () => {
    mockNovadeck({ 'deploy.doctor': vi.fn().mockResolvedValue({ success: true, data: doctor }), 'deploy.webServerCheck': vi.fn().mockResolvedValue({ success: true, data: null }) })
    const inplace = makeSummary({ config: { ...summary.config, layout: 'inplace' } })
    render(<PipelineEditor connectionId="conn-1" summary={inplace} onSaved={vi.fn()} onOpenServerCheck={vi.fn()} />)
    expect(screen.queryByText('Switch back on failure')).not.toBeInTheDocument()
    expect(screen.getByText('git reset --hard <new>')).toBeInTheDocument()
    expect(screen.queryByLabelText('Releases to keep')).not.toBeInTheDocument()
  })
})
