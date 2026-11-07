import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/Toast'
import { OUTPUT_LIMIT, useServerActionStore } from '@/stores/serverActionStore'
import type { ActionRun } from '@/types/server/core'
import { ActionHost } from './ActionHost'
import { emitOutput, emitRun, installFakeServer, makePlan, makeRun, runStep } from './testServer'
import type { LaunchRequest } from './types'
import { useActionLauncher } from './useActionLauncher'

function Harness({ request }: { request: LaunchRequest }) {
  const launcher = useActionLauncher({ tabId: 'tab-1', connectionId: 'conn-1' })
  return (
    <>
      <button type="button" onClick={() => launcher.launch(request)}>Install</button>
      <ActionHost tabId="tab-1" connectionId="conn-1" sessionKey="session-1" />
    </>
  )
}

async function setup(overrides: Record<string, unknown> = {}) {
  const server = installFakeServer(overrides)
  const onFinished = vi.fn<(run: ActionRun) => void>()
  const user = userEvent.setup()
  render(<Harness request={{ type: 'software.install', params: { name: 'redis' }, onFinished }} />)
  await user.click(screen.getByRole('button', { name: 'Install' }))
  return { server, onFinished, user }
}

async function startRun(overrides: Record<string, unknown> = {}) {
  const context = await setup(overrides)
  await context.user.click(await screen.findByRole('button', { name: 'Run 2 steps' }))
  return context
}

const progress = () => within(screen.getByRole('list', { name: 'Progress' }))

beforeEach(() => useServerActionStore.setState({ launches: {} }))

describe('ActionHost review', () => {
  it('plans on launch and shows each step with its command, badges and diff, without running', async () => {
    const { server } = await setup()
    expect(server.plan).toHaveBeenCalledWith('conn-1', 'software.install', { name: 'redis' })
    const dialog = await screen.findByRole('dialog', { name: 'Install Redis' })
    expect(dialog).toHaveTextContent('Installs redis-server from the Ubuntu archive.')
    const install = within(screen.getByRole('region', { name: 'Install redis-server' }))
    expect(install.getByText('apt-get install -y redis-server')).toBeInTheDocument()
    expect(install.getByText('runs as root')).toBeInTheDocument()
    expect(install.getByText('keeps running if you disconnect')).toBeInTheDocument()
    const config = within(screen.getByRole('region', { name: 'Set maxmemory' }))
    expect(config.getByText('can be undone')).toBeInTheDocument()
    expect(config.getByText('+maxmemory 256mb')).toHaveClass('text-nd-success-fg')
    expect(config.getByText('-maxmemory 0')).toHaveClass('text-nd-error-fg')
    expect(screen.getByRole('button', { name: 'Run 2 steps' })).toBeEnabled()
    expect(server.run).not.toHaveBeenCalled()
  })

  it('shows warnings from the plan', async () => {
    await setup({ plan: vi.fn().mockResolvedValue({ success: true, data: makePlan({ warnings: ['Port 6379 will listen on localhost only.'] }) }) })
    expect(await screen.findByText('Port 6379 will listen on localhost only.')).toBeInTheDocument()
  })

  it('disables Run and shows the sudoers hint when the plan is blocked by sudo', async () => {
    await setup({ plan: vi.fn().mockResolvedValue({ success: true, data: makePlan({ blocked: { kind: 'sudo', message: 'sudo asks for a password on this server.' } }) }) })
    expect(await screen.findByText('sudo asks for a password on this server.')).toBeInTheDocument()
    expect(screen.getByText(/NOPASSWD: ALL/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run 2 steps' })).toBeDisabled()
  })

  it('shows a plan error with Try again', async () => {
    const plan = vi.fn().mockResolvedValueOnce({ success: false, error: 'Unknown action' }).mockResolvedValueOnce({ success: true, data: makePlan() })
    const { user } = await setup({ plan })
    expect(await screen.findByText('Unknown action')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Run 2 steps' })).toBeInTheDocument()
  })

  it('closes on Escape and on Cancel', async () => {
    const { user } = await setup()
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Install' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('ActionHost run', () => {
  it('runs the reviewed plan and follows progress and output events', async () => {
    const { server } = await startRun()
    expect(server.run).toHaveBeenCalledWith('conn-1', 'session-1', 'plan-1')
    expect(await progress().findByRole('listitem', { name: 'Install redis-server: Running…' })).toBeInTheDocument()
    emitOutput({ runId: 'run-1', stepId: 'install', chunk: 'Reading package lists...\n' })
    expect(screen.getByRole('region', { name: 'Output: Install redis-server' })).toHaveTextContent('Reading package lists...')
    emitRun(makeRun({ steps: [runStep('install', 'Install redis-server', 'done'), runStep('config', 'Set maxmemory', 'running')] }))
    expect(progress().getByRole('listitem', { name: 'Install redis-server: Done' })).toBeInTheDocument()
    expect(progress().getByRole('listitem', { name: 'Set maxmemory: Running…' })).toBeInTheDocument()
  })

  it('binds run events by plan before the run call returns', async () => {
    let resolveRun: (value: unknown) => void = () => {}
    await startRun({ run: vi.fn(() => new Promise((resolve) => { resolveRun = resolve })) })
    emitRun(makeRun({ id: 'run-7' }))
    emitOutput({ runId: 'run-7', stepId: 'install', chunk: 'early output' })
    expect(screen.getByText('early output')).toBeInTheDocument()
    resolveRun({ success: true, data: { kind: 'started', run: makeRun({ id: 'run-7' }) } })
  })

  it('asks before stopping and stops after the current step', async () => {
    const { server, user } = await startRun()
    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(screen.getByText(/Stop after the current step\?/)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(server.stop).toHaveBeenCalledWith('run-1')
    expect(screen.getByRole('button', { name: 'Stopping after this step…' })).toBeDisabled()
  })

  it('keeps running when hidden and reopens from the pill', async () => {
    const { user } = await startRun()
    await user.click(await screen.findByRole('button', { name: 'Hide' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '1 action running, show details' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('refuses a second launch while one is running', async () => {
    const warn = vi.spyOn(toast, 'warning')
    const { server, user } = await startRun()
    await user.click(await screen.findByRole('button', { name: 'Hide' }))
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(warn).toHaveBeenCalledWith('An action is already running', expect.any(String))
    expect(server.plan).toHaveBeenCalledTimes(1)
  })

  it('keeps only the last 200 KB of a step output', async () => {
    await startRun()
    await screen.findByRole('list', { name: 'Progress' })
    emitOutput({ runId: 'run-1', stepId: 'install', chunk: 'HEAD' + 'x'.repeat(OUTPUT_LIMIT) })
    emitOutput({ runId: 'run-1', stepId: 'install', chunk: 'TAIL' })
    const output = useServerActionStore.getState().launches['tab-1'].output.install
    expect(output).toHaveLength(OUTPUT_LIMIT)
    expect(output.startsWith('HEAD')).toBe(false)
    expect(output.endsWith('TAIL')).toBe(true)
  })
})

describe('ActionHost result', () => {
  it('reports success and calls onFinished on Close', async () => {
    const { user, onFinished } = await startRun()
    await screen.findByRole('list', { name: 'Progress' })
    const done = makeRun({ status: 'done', finishedAt: 5_000, steps: [runStep('install', 'Install redis-server', 'done'), runStep('config', 'Set maxmemory', 'done')] })
    emitRun(done)
    expect(screen.getByText('Done. 2 steps finished in 4s.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onFinished).toHaveBeenCalledWith(done)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows what the last step printed after a successful run', async () => {
    await startRun()
    await screen.findByRole('list', { name: 'Progress' })
    emitOutput({ runId: 'run-1', stepId: 'config', chunk: 'nginx: configuration file test is successful\n' })
    emitRun(makeRun({ status: 'done', finishedAt: 5_000, steps: [runStep('install', 'Install redis-server', 'done'), runStep('config', 'Set maxmemory', 'done')] }))
    expect(screen.getByRole('region', { name: 'Output: Set maxmemory' })).toHaveTextContent('configuration file test is successful')
  })

  it('shows no output box after a successful run that printed nothing', async () => {
    await startRun()
    await screen.findByRole('list', { name: 'Progress' })
    emitRun(makeRun({ status: 'done', finishedAt: 5_000, steps: [runStep('install', 'Install redis-server', 'done'), runStep('config', 'Set maxmemory', 'done')] }))
    expect(screen.queryByRole('region', { name: /^Output:/ })).not.toBeInTheDocument()
  })

  it('shows the failed step, a plain message, its output and rolled-back steps', async () => {
    const { user, server, onFinished } = await startRun()
    await screen.findByRole('list', { name: 'Progress' })
    emitOutput({ runId: 'run-1', stepId: 'config', chunk: 'redis.conf changed\n' })
    emitRun(makeRun({
      status: 'failed',
      finishedAt: 4_000,
      steps: [runStep('install', 'Install redis-server', 'rolled-back'), runStep('config', 'Set maxmemory', 'failed')],
      failure: { kind: 'changed', stepId: 'config', message: 'sha256 mismatch' }
    }))
    expect(screen.getByText('The file changed on the server since you reviewed; review again.')).toBeInTheDocument()
    expect(screen.getByText('Failed at: Set maxmemory')).toBeInTheDocument()
    expect(screen.getByText('sha256 mismatch')).toBeInTheDocument()
    expect(screen.getByText(/These steps were undone: Install redis-server/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Output: Set maxmemory' })).toHaveTextContent('redis.conf changed')
    await user.click(screen.getByRole('button', { name: 'Review again' }))
    expect(server.plan).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('button', { name: 'Run 2 steps' })).toBeInTheDocument()
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('shows the new plan with a notice when the server changed since review', async () => {
    const fresh = makePlan({ planId: 'plan-2', steps: [makePlan().steps[0]] })
    await startRun({ run: vi.fn().mockResolvedValue({ success: true, data: { kind: 'stale', plan: fresh } }) })
    expect(await screen.findByText('The server changed since you reviewed this. Check the plan again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run 1 step' })).toBeEnabled()
  })

  it('tells the user when another action is running on the server', async () => {
    await startRun({ run: vi.fn().mockResolvedValue({ success: true, data: { kind: 'busy', runId: 'run-9' } }) })
    expect(await screen.findByText('Another action is running on this server')).toBeInTheDocument()
  })
})
