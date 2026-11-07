import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionTab } from '@/types/session'
import { useConnectionStore } from './connectionStore'
import { DEFAULT_SERVER_ROUTE, serverRouteOf, useServerNavStore } from './serverNavStore'

const focusFeature = vi.fn(async () => true)

const tab = (overrides: Partial<ConnectionTab> = {}): ConnectionTab => ({
  id: 'tab-1',
  sessionId: 'session-1',
  sessionName: 'Example',
  status: 'connected',
  activeSubTab: 'terminal',
  ...overrides
})

const storedTab = () => useConnectionStore.getState().tabs.find((t) => t.id === 'tab-1')

beforeEach(() => {
  vi.stubGlobal('window', { novadeck: { window: { focusFeature } } })
  useServerNavStore.setState({ routes: {} })
  useConnectionStore.setState({ tabs: [] })
})

afterEach(() => {
  vi.unstubAllGlobals()
  focusFeature.mockClear()
})

describe('serverNavStore', () => {
  it('starts every tab at the overview', () => {
    expect(serverRouteOf('tab-1')).toEqual(DEFAULT_SERVER_ROUTE)
  })

  it('keeps one route per tab', () => {
    useServerNavStore.getState().navigate('tab-1', { section: 'sites' })
    useServerNavStore.getState().navigate('tab-2', { section: 'docker' })
    expect(serverRouteOf('tab-1')).toEqual({ section: 'sites' })
    expect(serverRouteOf('tab-2')).toEqual({ section: 'docker' })
  })

  it('openServer sets the route and switches the tab to Server', () => {
    useConnectionStore.setState({ tabs: [tab()] })
    useServerNavStore.getState().openServer('tab-1', { section: 'sites', sub: 'https' })
    expect(serverRouteOf('tab-1')).toEqual({ section: 'sites', sub: 'https' })
    expect(storedTab()).toMatchObject({ activeSubTab: 'server', runningSubTabs: undefined })
    expect(focusFeature).not.toHaveBeenCalled()
  })

  it('openServer starts the Server tab again when it was shut down', () => {
    useConnectionStore.setState({ tabs: [tab({ runningSubTabs: ['terminal'] })] })
    useServerNavStore.getState().openServer('tab-1', { section: 'overview' })
    expect(storedTab()?.runningSubTabs).toEqual(['terminal', 'server'])
  })

  it('openServer focuses the Server window when it is detached', () => {
    useConnectionStore.setState({ tabs: [tab({ detachedSubTabs: ['server'] })] })
    useServerNavStore.getState().openServer('tab-1', { section: 'services' })
    expect(focusFeature).toHaveBeenCalledWith({ tabId: 'tab-1', subTab: 'server' })
  })
})
