import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Globe, LayoutDashboard, Settings, Wrench } from 'lucide-react'
import { mockNovadeck } from '@/test/novadeck'
import { useServerNavStore } from '@/stores/serverNavStore'
import type { AttentionItem } from '@/types/server/core'
import type { ConnectionTab } from '@/types/session'
import type { SectionModule, ServerSectionContext } from './sections/types'
import { ServerView } from './ServerView'

const mounts = vi.hoisted(() => ({ sites: 0, overview: 0 }))

vi.mock('./sections/registry', async () => {
  const { useTabActive } = await import('@/components/tabActive')
  const { useEffect } = await import('react')
  function Sites({ ctx }: { ctx: ServerSectionContext }) {
    const tabActive = useTabActive()
    useEffect(() => { mounts.sites += 1 }, [])
    return <div>sites page {ctx.route.sub ?? 'list'} {tabActive ? 'awake' : 'paused'}</div>
  }
  function Overview() {
    useEffect(() => { mounts.overview += 1 }, [])
    return <div>overview page</div>
  }
  const section = (id: SectionModule['id'], label: string, icon: SectionModule['icon'], placement: SectionModule['placement'], Component: SectionModule['Component']): SectionModule =>
    ({ id, label, icon, placement, Component })
  const SECTIONS = [
    section('overview', 'Overview', LayoutDashboard, 'main', Overview),
    section('sites', 'Sites', Globe, 'main', Sites),
    section('settings', 'Server settings', Settings, 'bottom', () => <div>settings page</div>),
    section('setup', 'Set up this server', Wrench, 'hidden', () => <div>setup page</div>)
  ]
  return { SECTIONS, sectionById: (id: string) => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0] }
})

const tab: ConnectionTab = { id: 'tab-1', sessionId: 'session-1', sessionName: 'Example server', status: 'connected', activeSubTab: 'server' }

const item = (overrides: Partial<AttentionItem>): AttentionItem => ({
  id: 'x', area: 'overview', level: 'info', rank: 10, title: 'T', detail: 'D', actionLabel: 'Fix', route: { section: 'overview' }, ...overrides
})

beforeEach(() => {
  mounts.sites = 0
  mounts.overview = 0
  useServerNavStore.setState({ routes: {} })
  mockNovadeck({ 'server.scan': vi.fn(async () => ({ success: true, data: {} })) })
})

describe('ServerView', () => {
  it('lists main sections, pins bottom ones and hides hidden ones', () => {
    render(<ServerView tab={tab} active attention={[]} />)
    const nav = screen.getByRole('navigation', { name: 'Server sections' })
    expect(nav).toHaveTextContent('Overview')
    expect(nav).toHaveTextContent('Sites')
    expect(nav).toHaveTextContent('Server settings')
    expect(nav).not.toHaveTextContent('Set up this server')
    expect(screen.getByText('overview page')).toBeInTheDocument()
  })

  it('shows one badge per section with the count of its attention items', () => {
    const attention = [item({ area: 'sites', level: 'warning' }), item({ area: 'sites', level: 'error' }), item({ area: 'overview' })]
    render(<ServerView tab={tab} active attention={attention} />)
    expect(screen.getByRole('button', { name: /Sites/ })).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: /Sites/ }).querySelector('.text-nd-error-fg')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Overview/ }).querySelector('.text-nd-info-fg')).not.toBeNull()
  })

  it('keeps Sites mounted but paused after leaving it, and unmounts other sections', () => {
    render(<ServerView tab={tab} active attention={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /Sites/ }))
    expect(screen.getByText(/sites page list awake/).parentElement).not.toHaveClass('hidden')
    fireEvent.click(screen.getByRole('button', { name: /Overview/ }))
    expect(screen.getByText(/sites page list paused/).parentElement).toHaveClass('hidden')
    expect(mounts.sites).toBe(1)
    expect(mounts.overview).toBe(2)
  })

  it('unmounts the open section while the Server tab is hidden', () => {
    const { rerender } = render(<ServerView tab={tab} active attention={[]} />)
    rerender(<ServerView tab={tab} active={false} attention={[]} />)
    expect(screen.queryByText('overview page')).toBeNull()
  })

  it('follows routes set from outside, like deep links', () => {
    render(<ServerView tab={tab} active attention={[]} />)
    act(() => useServerNavStore.getState().navigate('tab-1', { section: 'sites', sub: 'https' }))
    expect(screen.getByText(/sites page https awake/)).toBeInTheDocument()
  })
})
