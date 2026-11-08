import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import { makeRun, runStep } from '../../action/testServer'
import { RunResult } from './RunResult'

const finished = (deployStatus: 'done' | 'skipped' = 'done') =>
  makeRun({ status: 'done', steps: [runStep('update.upgrade', 'Update', 'done'), runStep('security.deploy-user', 'Create deploy', deployStatus)] })

const ids = { connectionId: 'conn-1', sessionId: 'session-1' }

function bridge(checkLogin: ReturnType<typeof vi.fn>) {
  const update = vi.fn(async () => ({}))
  mockNovadeck({ 'server.setup.checkLogin': checkLogin, 'sessions.update': update })
  return update
}

describe('RunResult deploy user switch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves the new login user only after a fresh login as that user works', async () => {
    const checkLogin = vi.fn(async () => ({ success: true, data: undefined }))
    const update = bridge(checkLogin)
    render(<RunResult run={finished()} deployUser="deploy" keyLogin {...ids} />)
    await userEvent.click(screen.getByRole('button', { name: 'Log in as deploy from now on' }))
    expect(checkLogin).toHaveBeenCalledWith('conn-1', 'deploy')
    expect(update).toHaveBeenCalledWith('session-1', { username: 'deploy' })
    expect(await screen.findByText(/Next time you connect, Shellway logs in as deploy/)).toBeInTheDocument()
  })

  it('leaves the saved session alone when the login fails', async () => {
    const update = bridge(vi.fn(async () => ({ success: false, error: 'All configured authentication methods failed' })))
    render(<RunResult run={finished()} deployUser="deploy" keyLogin {...ids} />)
    await userEvent.click(screen.getByRole('button', { name: 'Log in as deploy from now on' }))
    expect(await screen.findByText(/All configured authentication methods failed/)).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('offers nothing when no deploy user was created or the session logs in with a password', () => {
    bridge(vi.fn())
    const { rerender } = render(<RunResult run={finished('skipped')} deployUser="deploy" keyLogin {...ids} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(<RunResult run={finished()} deployUser="deploy" keyLogin={false} {...ids} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
