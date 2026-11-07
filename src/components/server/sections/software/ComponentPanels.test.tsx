import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ServerFacts } from '@/types/server/core'
import { PACKAGES_UBUNTU, PHP_OUTPUT, UPDATES_UBUNTU, USAGE } from '@/utils/server/software/fixtures/outputs'
import { parsePackages } from '@/utils/server/software/packages'
import { parsePhp } from '@/utils/server/software/php'
import { PACKAGES_PROBE, PHP_PROBE, UPDATES_PROBE, USAGE_PROBE } from '@/utils/server/software/types'
import { parseUpdates } from '@/utils/server/software/updates'
import { parseUsage } from '@/utils/server/software/usage'
import type { ServerSectionContext } from '../types'

const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 1 })
const EXTRA = ['ufw\tinstall ok installed\t0.36.2-6', 'fail2ban\tinstall ok installed\t1.0.2-3', 'certbot\tinstall ok installed\t2.9.0-1', 'apache2\tinstall ok installed\t2.4.58-1ubuntu8'].join('\n')
const packages = PACKAGES_UBUNTU.replace('apache2\tdeinstall ok config-files\t2.4.58-1ubuntu8', EXTRA).replace('Candidate: 1.24.0-2ubuntu7.3', 'Candidate: 1.24.0-2ubuntu7.1')

const facts: ServerFacts = {
  [UPDATES_PROBE]: ok(parseUpdates(UPDATES_UBUNTU)),
  [PACKAGES_PROBE]: ok(parsePackages(packages)),
  [PHP_PROBE]: ok(parsePhp(PHP_OUTPUT)),
  [USAGE_PROBE]: ok(parseUsage(USAGE))
}

vi.mock('@/components/server/useWithOsFamily', () => ({ useWithOsFamily: () => (params: Record<string, unknown>) => params }))
vi.mock('../../useServerFacts', () => ({ useServerFacts: () => ({ facts, loading: false, error: null, refresh: vi.fn() }) }))
vi.mock('../../action', () => ({ useActionLauncher: () => ({ launch: vi.fn() }) }))

import { SoftwareSection } from './SoftwareSection'

const navigate = vi.fn()

const ctx = (sub: string): ServerSectionContext => ({
  tabId: 't',
  connectionId: 'c',
  sessionId: 's',
  sessionName: 'Test server',
  connectionStatus: 'connected',
  route: { section: 'software', sub },
  active: true,
  navigate
})

describe('component panel links', () => {
  beforeEach(() => navigate.mockReset())

  it.each([
    ['certbot', 'Open Sites', 'sites'],
    ['ufw', 'Open Security', 'security'],
    ['fail2ban', 'Open Security', 'security'],
    ['unattended-upgrades', 'Open Security', 'security'],
    ['supervisor', 'Open Cron & workers', 'jobs']
  ])('%s links to %s', (panel, label, section) => {
    render(<SoftwareSection ctx={ctx(panel)} />)
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(navigate).toHaveBeenCalledWith({ section })
  })

  it.each(['apache', 'redis'])('%s offers a button to Services', (panel) => {
    render(<SoftwareSection ctx={ctx(panel)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Services' }))
    expect(navigate).toHaveBeenCalledWith({ section: 'services' })
  })

  it('labels nginx Configure and apache Manage in the list', () => {
    render(<SoftwareSection ctx={ctx('apache')} />)
    expect(screen.getByRole('button', { name: 'Configure' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Manage' }).length).toBeGreaterThan(0)
  })
})
