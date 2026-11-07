import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { DISK_PROBE, LOAD_PROBE, REBOOT_ACTION, SYSTEM_PROBE } from '@/utils/server/overview/ids'
import type { ServerSectionContext } from '../types'

const launch = vi.fn()
const state = vi.hoisted(() => ({ facts: {} as ServerFacts, sites: [] as unknown[], runner: { installed: true } as unknown }))

vi.mock('../../useServerFacts', () => ({
  useServerFacts: () => ({ facts: state.facts, loading: false, error: null, refresh: vi.fn() })
}))
vi.mock('../../action', () => ({ useActionLauncher: () => ({ launch }) }))
vi.mock('@/components/deploy/useDeploySites', () => ({
  useDeploySites: () => ({ runner: state.runner, sites: state.sites, pcDrift: {}, loading: false, installing: false, error: null, refresh: vi.fn(), installRunner: vi.fn() })
}))
vi.mock('@/components/ssl/useSslReport', () => ({ useSslReport: () => ({ report: null, loading: false, error: null, refresh: vi.fn() }) }))

const { OverviewPage } = await import('./OverviewPage')

const NOW = 1_800_000_000

const ok = (data: unknown) => ({ status: 'ok' as const, data, at: 1 })

const LOAD = { cpuPercent: 34, cpus: 4, load: [0.84, 0.5, 0.3], memTotalBytes: 8 * 1024 ** 3, memAvailableBytes: 3 * 1024 ** 3, swapTotalBytes: 0, swapFreeBytes: 0, rxPerSec: 0, txPerSec: 0 }
const ROOT = { device: '/dev/vda1', type: 'ext4', sizeBytes: 80 * 1024 ** 3, usedBytes: 66 * 1024 ** 3, availBytes: 14 * 1024 ** 3, usedPercent: 92, mount: '/' }

function stubNovadeck() {
  const off = () => () => () => {}
  Object.defineProperty(window, 'novadeck', {
    configurable: true,
    value: {
      monitor: { onData: off(), onStatus: off(), onError: off(), getHistory: vi.fn().mockResolvedValue([]), start: vi.fn().mockResolvedValue({ success: false, error: 'unsupported' }), stop: vi.fn().mockResolvedValue({ success: true }) },
      health: { getHealth: vi.fn().mockResolvedValue({ latencyMs: 32 }) }
    }
  })
}

const context = (overrides: Partial<ServerSectionContext> = {}): ServerSectionContext => ({
  tabId: 't1',
  connectionId: 'c1',
  sessionId: 's1',
  sessionName: 'Test server',
  connectionStatus: 'connected',
  route: { section: 'overview' },
  active: true,
  navigate: vi.fn(),
  ...overrides
})

async function renderPage(ctx: ServerSectionContext) {
  render(<OverviewPage ctx={ctx} />)
  await act(async () => {})
}

describe('OverviewPage', () => {
  beforeEach(() => {
    stubNovadeck()
    state.sites = []
    state.runner = { installed: true }
    state.facts = { [LOAD_PROBE]: ok(LOAD), [DISK_PROBE]: ok([ROOT]), [SYSTEM_PROBE]: ok({ webServers: ['nginx'], installedAt: NOW - 400 * 86400, bootedAt: NOW, now: NOW }) }
  })

  it('shows health from the probe when the monitor is unavailable, plus attention and server info', async () => {
    await renderPage(context())
    expect(screen.getByText('34%')).toBeInTheDocument()
    expect(screen.getByText('66 of 80 GB on /')).toBeInTheDocument()
    expect(screen.getByText('Disk 92% full')).toBeInTheDocument()
    expect(screen.getByText('Server info')).toBeInTheDocument()
    expect(screen.queryByText('Set up this server')).not.toBeInTheDocument()
  })

  it('opens the disk page from the attention row and create site from the header', async () => {
    const ctx = context()
    await renderPage(ctx)
    fireEvent.click(screen.getByRole('button', { name: 'Clean up' }))
    expect(ctx.navigate).toHaveBeenCalledWith({ section: 'overview', sub: 'disk' })
    fireEvent.click(screen.getByRole('button', { name: /Create site/ }))
    expect(ctx.navigate).toHaveBeenCalledWith({ section: 'sites', sub: 'create' })
  })

  it('launches the reboot plan from the header and from a deep link', async () => {
    const ctx = context({ route: { section: 'overview', params: { action: 'reboot' } } })
    await renderPage(ctx)
    expect(launch).toHaveBeenCalledWith({ type: REBOOT_ACTION, params: {} })
    expect(ctx.navigate).toHaveBeenCalledWith({ section: 'overview' })
    fireEvent.click(screen.getByRole('button', { name: /Reboot/ }))
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('shows the setup entry on a fresh server instead of the empty sites card', async () => {
    state.facts = { ...state.facts, [SYSTEM_PROBE]: ok({ webServers: [], installedAt: NOW - 86400, bootedAt: NOW, now: NOW }), [DISK_PROBE]: ok([{ ...ROOT, usedPercent: 10 }]) }
    const ctx = context()
    await renderPage(ctx)
    expect(screen.getByText('Set up this server')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Sites' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start setup' }))
    expect(ctx.navigate).toHaveBeenCalledWith({ section: 'setup' })
  })
})
