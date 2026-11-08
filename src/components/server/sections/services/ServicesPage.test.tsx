import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { PROBE } from '@/utils/server/services/probes'
import type { ServerSectionContext } from '../types'
import { ServicesPage } from './ServicesPage'

const launch = vi.fn()
const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 0 })

const FACTS: ServerFacts = {
  [PROBE.systemd]: ok({
    installed: true,
    units: [
      { name: 'redis-server', description: 'Advanced key-value store', load: 'loaded', active: 'failed', sub: 'failed', enabled: true, cpuPercent: null, memoryBytes: null, sinceSeconds: 120 },
      { name: 'systemd-networkd-wait-online', description: 'Wait for Network to be Configured', load: 'loaded', active: 'failed', sub: 'failed', enabled: true, cpuPercent: null, memoryBytes: null, sinceSeconds: 259201, runsOnce: true },
      { name: 'nginx', description: 'web server', load: 'loaded', active: 'active', sub: 'running', enabled: true, cpuPercent: 0.4, memoryBytes: 39845888, sinceSeconds: 2160000 }
    ]
  }),
  [PROBE.supervisor]: { status: 'unavailable', reason: 'Needs sudo without a password.', at: 0 },
  [PROBE.failed]: ok({ units: { 'redis-server': ["Nov 07 09:41:16 web redis-server[812]: Can't open the log file: Permission denied"] }, programs: {}, nginxTest: null, apacheTest: null, listeners: [] }),
  [PROBE.usage]: ok({ nginx: ['shop.example.com', 'api.example.com'], apache: [], php: {} })
}

vi.mock('../../useServerFacts', () => ({ useServerFacts: () => ({ facts: FACTS, loading: false, error: null, refresh: vi.fn() }) }))
vi.mock('../../action', () => ({ useActionLauncher: () => ({ launch }) }))
vi.mock('./LogDrawer', () => ({ LogDrawer: () => null }))

const ctx: ServerSectionContext = { tabId: 't1', connectionId: 'c1', sessionId: 's1', sessionName: 'Test server', connectionStatus: 'connected', route: { section: 'services' }, active: true, navigate: vi.fn() }

describe('ServicesPage', () => {
  it('shows a failed unit with its journal, hint and one-click fix', () => {
    render(<ServicesPage ctx={ctx} />)
    expect(screen.getByText('failed 2 min ago')).toBeInTheDocument()
    expect(screen.getByText(/Can't open the log file/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fix and start' }))
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ type: 'services.fix', params: { fix: 'redis-log-owner', unit: 'redis-server' } }))
  })

  it('shows site counts, reloads nginx and explains unavailable sources', () => {
    render(<ServicesPage ctx={ctx} />)
    expect(screen.getByText('web server · 2 sites')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(launch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'services.control', params: { kind: 'systemd', name: 'nginx', verb: 'reload', user: null } }))
    expect(screen.getByText(/Supervisor programs: Needs sudo/)).toBeInTheDocument()
  })

  it('offers Clear for a failed unit that only runs once', () => {
    render(<ServicesPage ctx={ctx} />)
    const clear = screen.getByRole('button', { name: 'Clear' })
    expect(clear).toHaveAttribute('title', 'This runs once and nothing runs it again. Clear removes the failed mark without running it.')
    fireEvent.click(clear)
    expect(launch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'services.control', params: { kind: 'systemd', name: 'systemd-networkd-wait-online', verb: 'reset-failed', user: null } }))
  })

  it('filters to failed services', () => {
    render(<ServicesPage ctx={ctx} />)
    fireEvent.click(screen.getByRole('tab', { name: /Failed/ }))
    expect(screen.queryByText('nginx')).not.toBeInTheDocument()
    expect(screen.getByText('redis-server')).toBeInTheDocument()
  })
})
