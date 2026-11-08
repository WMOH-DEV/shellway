import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ServerFacts } from '@/types/server/core'
import { APT_CLEAN_ACTION, AUTOREMOVE_ACTION, CLEANUP_PROBE, DISK_PROBE } from '@/utils/server/overview/ids'
import type { ServerSectionContext } from '../types'

const launch = vi.fn()
const scanned = vi.fn()
const MB = 1024 ** 2

const FACTS: ServerFacts = {
  [DISK_PROBE]: { status: 'ok', at: 1, data: [{ device: '/dev/vda1', type: 'ext4', sizeBytes: 80 * 1024 ** 3, usedBytes: 66 * 1024 ** 3, availBytes: 14 * 1024 ** 3, usedPercent: 83, mount: '/' }] },
  [CLEANUP_PROBE]: { status: 'ok', at: 1, data: { apt: { cacheBytes: 412 * MB, autoremove: [{ name: 'linux-image-6.8.0-45-generic', sizeBytes: 300 * MB }] }, journalBytes: 100 * MB } }
}

vi.mock('../../useServerFacts', () => ({
  useServerFacts: (_ctx: unknown, ids: string[]) => {
    scanned(ids)
    return { facts: FACTS, loading: false, error: null, refresh: vi.fn() }
  }
}))
vi.mock('../../action', () => ({ useActionLauncher: () => ({ launch }) }))

const { DiskPage } = await import('./DiskPage')

const ctx: ServerSectionContext = {
  tabId: 't1', connectionId: 'c1', sessionId: 's1', sessionName: 'Test server', connectionStatus: 'connected',
  route: { section: 'overview', sub: 'disk' }, active: true, navigate: vi.fn()
}

describe('DiskPage', () => {
  it('shows filesystems and cleanup options with their commands and sizes', () => {
    render(<DiskPage ctx={ctx} />)
    expect(screen.getByText('83% · 66 of 80 GB')).toBeInTheDocument()
    expect(screen.getByText('apt-get clean')).toBeInTheDocument()
    expect(screen.getByText('about 412 MB')).toBeInTheDocument()
    expect(screen.getByText('Will remove: linux-image-6.8.0-45-generic')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trim' })).toBeDisabled()
  })

  it('launches cleanup actions through the engine and links Docker cleanup', () => {
    render(<DiskPage ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(launch.mock.calls.map(([request]) => request.type)).toEqual([APT_CLEAN_ACTION, AUTOREMOVE_ACTION])
    fireEvent.click(screen.getByRole('button', { name: 'Open Docker' }))
    expect(ctx.navigate).toHaveBeenCalledWith({ section: 'docker' })
  })

  it('scans folders only after the user asks', () => {
    render(<DiskPage ctx={ctx} />)
    expect(scanned.mock.calls.some(([ids]) => ids.includes('overview.folders'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Scan folders' }))
    expect(scanned.mock.calls.some(([ids]) => ids.includes('overview.folders'))).toBe(true)
  })
})
