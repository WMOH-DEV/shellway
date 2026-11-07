import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ServerFacts } from '@/types/server/core'
import { PACKAGES_UBUNTU, PHP_OUTPUT, UPDATES_UBUNTU, USAGE } from '@/utils/server/software/fixtures/outputs'
import { parsePackages } from '@/utils/server/software/packages'
import { parsePhp } from '@/utils/server/software/php'
import { PACKAGES_PROBE, PHP_PROBE, UPDATES_PROBE, USAGE_PROBE } from '@/utils/server/software/types'
import { parseUpdates } from '@/utils/server/software/updates'
import { parseUsage } from '@/utils/server/software/usage'
import type { ServerSectionContext } from '../types'

const launch = vi.fn()
const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 1 })
const facts: ServerFacts = {
  [UPDATES_PROBE]: ok(parseUpdates(UPDATES_UBUNTU)),
  [PACKAGES_PROBE]: ok(parsePackages(PACKAGES_UBUNTU)),
  [PHP_PROBE]: ok(parsePhp(PHP_OUTPUT)),
  [USAGE_PROBE]: ok(parseUsage(USAGE))
}

vi.mock('../../useServerFacts', () => ({ useServerFacts: () => ({ facts, loading: false, error: null, refresh: vi.fn() }) }))
vi.mock('../../action', () => ({ useActionLauncher: () => ({ launch }) }))

import { SoftwareSection } from './SoftwareSection'

const ctx = (sub?: string): ServerSectionContext => ({
  tabId: 't',
  connectionId: 'c',
  sessionId: 's',
  sessionName: 'Test server',
  connectionStatus: 'connected',
  route: { section: 'software', sub },
  active: true,
  navigate: vi.fn()
})

describe('SoftwareSection', () => {
  beforeEach(() => launch.mockReset())

  it('shows the update banner and installs everything through the action launcher', () => {
    render(<SoftwareSection ctx={ctx()} />)
    expect(screen.getByText('4 system updates · 2 security')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Install all 4' }))
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ type: 'software.upgrade', params: { mode: 'all' } }))
  })

  it('lists the catalog and the PHP panel by default', () => {
    render(<SoftwareSection ctx={ctx()} />)
    expect(screen.getByText('running · 2 sites')).toBeInTheDocument()
    expect(screen.getByText('Extensions · 8.3')).toBeInTheDocument()
    expect(screen.getByText(/app.example.com needs imagick/)).toBeInTheDocument()
  })

  it('applies a changed php.ini value', () => {
    render(<SoftwareSection ctx={ctx('php')} />)
    fireEvent.change(screen.getByDisplayValue('256M'), { target: { value: '512M' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0])
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ type: 'software.php-ini', params: { version: '8.3', values: { memory_limit: '512M' } } }))
  })

  it('shows database bindings in the MySQL panel', () => {
    render(<SoftwareSection ctx={ctx('mysql')} />)
    expect(screen.getByText('127.0.0.1:3306')).toBeInTheDocument()
  })
})
