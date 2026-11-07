import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { RunRecord } from '@/types/createSite'
import type { RunnerInfo } from '@/types/deploy'
import { SitesOverview, type CreateSiteEntry } from '../SitesOverview'
import type { DeploySites } from '../useDeploySites'
import { makeRun } from './testRun'

const data = (runner: RunnerInfo): DeploySites => ({
  runner,
  sites: [],
  pcDrift: {},
  loading: false,
  installing: false,
  error: null,
  refresh: vi.fn(),
  installRunner: vi.fn()
})

function renderOverview(runner: RunnerInfo, unfinished: RunRecord | null = null) {
  const createSite: CreateSiteEntry = { unfinished, onCreate: vi.fn(), onOpenRun: vi.fn() }
  render(
    <SitesOverview
      data={data(runner)}
      filters={{ query: '', filter: 'all', setQuery: vi.fn(), setFilter: vi.fn() }}
      away={{ summary: null, dismiss: vi.fn() }}
      serverName="Test server"
      user="deploy"
      starting={new Set()}
      actions={{ open: vi.fn(), deploy: vi.fn(), cancel: vi.fn(), resume: vi.fn(), edit: vi.fn(), keySetup: vi.fn() }}
      createSite={createSite}
      onAdd={vi.fn()}
    />
  )
  return { createSite, user: userEvent.setup() }
}

describe('Create site entry in the Deploy overview', () => {
  it('sits next to Add site in the header and in the empty state', async () => {
    const { createSite, user } = renderOverview({ installed: true, version: 3, bundledVersion: 3 })
    const buttons = screen.getAllByRole('button', { name: /Create site/ })
    expect(buttons).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /Add site/ })).toHaveLength(2)
    await user.click(buttons[0])
    expect(createSite.onCreate).toHaveBeenCalled()
  })

  it('is hidden until the deploy runner is installed', () => {
    renderOverview({ installed: false, version: null, bundledVersion: 3 })
    expect(screen.queryByRole('button', { name: /Create site/ })).not.toBeInTheDocument()
  })

  it('offers to open a run that did not finish', async () => {
    const run = makeRun()
    const { createSite, user } = renderOverview({ installed: true, version: 3, bundledVersion: 3 }, run)
    expect(screen.getByText('A Create site run for shop.example.com did not finish.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(createSite.onOpenRun).toHaveBeenCalledWith(run)
  })
})
