import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import { GithubCard } from './AccountCards'

function mockDeploy(tokenSaved: boolean, saveResult: { success: boolean; error?: string } = { success: true }) {
  const saveGithubToken = vi.fn().mockResolvedValue(saveResult)
  const clearGithubToken = vi.fn().mockResolvedValue({ success: true })
  mockNovadeck({
    'deploy.githubTokenSaved': vi.fn().mockResolvedValue({ success: true, data: tokenSaved }),
    'deploy.saveGithubToken': saveGithubToken,
    'deploy.clearGithubToken': clearGithubToken
  })
  return { saveGithubToken, clearGithubToken }
}

describe('GithubCard', () => {
  it('saves a token and switches to the saved state', async () => {
    const { saveGithubToken } = mockDeploy(false)
    const user = userEvent.setup()
    render(<GithubCard />)

    const input = await screen.findByLabelText('GitHub token')
    const save = screen.getByRole('button', { name: 'Save token' })
    expect(save).toBeDisabled()

    await user.type(input, ' ghp_abc123 ')
    await user.click(save)

    expect(saveGithubToken).toHaveBeenCalledWith('ghp_abc123')
    expect(await screen.findByText('Token saved')).toBeInTheDocument()
    expect(screen.queryByLabelText('GitHub token')).not.toBeInTheDocument()
  })

  it('shows the error and keeps the form when saving fails', async () => {
    mockDeploy(false, { success: false, error: 'This does not look like a GitHub token' })
    const user = userEvent.setup()
    render(<GithubCard />)

    await user.type(await screen.findByLabelText('GitHub token'), 'bad')
    await user.click(screen.getByRole('button', { name: 'Save token' }))

    expect(await screen.findByText('This does not look like a GitHub token')).toBeInTheDocument()
    expect(screen.getByText('No token')).toBeInTheDocument()
  })

  it('replaces a saved token', async () => {
    const { saveGithubToken } = mockDeploy(true)
    const user = userEvent.setup()
    render(<GithubCard />)

    await user.click(await screen.findByRole('button', { name: 'Replace' }))
    await user.type(screen.getByLabelText('GitHub token'), 'ghp_new')
    await user.click(screen.getByRole('button', { name: 'Save token' }))

    expect(saveGithubToken).toHaveBeenCalledWith('ghp_new')
    expect(await screen.findByRole('button', { name: 'Replace' })).toBeInTheDocument()
  })

  it('forgets a saved token', async () => {
    const { clearGithubToken } = mockDeploy(true)
    const user = userEvent.setup()
    render(<GithubCard />)

    await user.click(await screen.findByRole('button', { name: 'Forget' }))

    await waitFor(() => expect(clearGithubToken).toHaveBeenCalledOnce())
    expect(await screen.findByLabelText('GitHub token')).toBeInTheDocument()
    expect(screen.getByText('No token')).toBeInTheDocument()
  })
})
