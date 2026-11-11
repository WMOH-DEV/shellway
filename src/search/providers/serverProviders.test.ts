import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@/stores/connectionStore'
import { useServerFactsStore } from '@/stores/serverFactsStore'
import { serverRouteOf } from '@/stores/serverNavStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUIStore } from '@/stores/uiStore'
import type { ServerFacts } from '@/types/server/core'
import { applyPatch } from '../cachePatch'
import { useSearchCacheStore } from '../cacheClient'
import { useSearchIntentStore } from '../intentStore'
import { createServicesProvider } from './services'
import { createSitesProvider } from './sites'
import { collect, EMPTY_CONTEXT, makeQuery, makeSession, makeTab, resetSearchState, stubBrowser } from './testHelpers'

const FACTS: ServerFacts = {
  'sites.inventory': {
    status: 'ok',
    at: 1,
    data: {
      user: 'deploy',
      fpmVersions: [],
      sites: [{ name: 'shop.example.com', owner: 'deploy', path: '/var/www/shop' }],
      vhosts: [{ sha256: 'a'.repeat(64), path: '/etc/nginx/sites-enabled/shop', realPath: '/etc/nginx/sites-enabled/shop', content: 'server { server_name shop.example.com; }' }]
    }
  },
  'services.systemd': {
    status: 'ok',
    at: 1,
    data: {
      installed: true,
      units: [{ name: 'nginx', description: 'web', load: 'loaded', active: 'active', sub: 'running', enabled: true, cpuPercent: null, memoryBytes: null, sinceSeconds: 5 }]
    }
  },
  'services.containers': {
    status: 'ok',
    at: 1,
    data: {
      installed: true,
      access: null,
      containers: [{ id: 'c1', name: 'redis-cache', image: 'redis', state: 'running', status: 'Up 2 hours', project: '', restartPolicy: 'always', cpuPercent: null, memoryBytes: null }]
    }
  }
}

describe('sites and services providers', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = stubBrowser().writeText
    resetSearchState()
    useSessionStore.setState({ sessions: [makeSession()] })
    useConnectionStore.setState({ tabs: [makeTab()], activeTabId: 't1' })
    useServerFactsStore.setState({ byConnection: { t1: FACTS } })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('finds live sites by name and by root', async () => {
    const provider = createSitesProvider()
    const [byName] = await collect(provider, makeQuery('shop'))
    expect(byName).toMatchObject({ id: 'site:s1:shop.example.com', title: 'shop.example.com', icon: 'site' })
    expect(byName.subtitle).toBe('site · /var/www/shop · Shop server')
    expect(await collect(provider, makeQuery('var www'))).toHaveLength(1)
  })

  it('reads cached sites for a server without live facts and flags it disconnected', async () => {
    useServerFactsStore.setState({ byConnection: {} })
    useConnectionStore.setState({ tabs: [] })
    useSearchCacheStore.setState({
      snapshot: applyPatch(
        useSearchCacheStore.getState().snapshot!,
        { kind: 'server', scopeId: 's1', sites: [{ name: 'blog.example.com', root: '/var/www/blog' }], services: [] },
        1
      )
    })
    const [site] = await collect(createSitesProvider(), makeQuery('blog'))
    expect(site.hint).toBe('disconnected')
  })

  it('boosts the active site', async () => {
    const context = { ...EMPTY_CONTEXT, activeSessionId: 's1', activeSite: 'shop.example.com' }
    const [site] = await collect(createSitesProvider(), makeQuery('shop', { context }))
    expect(site.scoreHints.context).toBe(1)
  })

  it('opens a site in the server tab, reveals its folder and copies the name', async () => {
    const provider = createSitesProvider()
    const [site] = await collect(provider, makeQuery('shop'))
    const actions = provider.actions(site)
    actions.find((a) => a.role === 'primary')!.run()
    expect(serverRouteOf('t1')).toEqual({ section: 'sites', params: { site: 'shop.example.com' } })
    expect(useConnectionStore.getState().tabs[0].activeSubTab).toBe('server')
    actions.find((a) => a.role === 'secondary')!.run()
    expect(useSearchIntentStore.getState().pending.s1).toEqual([{ kind: 'sftp-reveal', path: '/var/www/shop/' }])
    actions.find((a) => a.role === 'copy')!.run()
    expect(writeText).toHaveBeenCalledWith('shop.example.com')
  })

  it('requests a connection when the server tab is not connected', async () => {
    const provider = createSitesProvider()
    const [site] = await collect(provider, makeQuery('shop'))
    useConnectionStore.setState({ tabs: [] })
    provider.actions(site).find((a) => a.role === 'primary')!.run()
    expect(useUIStore.getState().connectSessionId).toBe('s1')
  })

  it('finds services and containers and opens them in the services section', async () => {
    const provider = createServicesProvider()
    const results = await collect(provider, makeQuery('redis'))
    expect(results[0]).toMatchObject({ providerId: 'services', title: 'redis-cache', subtitle: 'container · Shop server' })
    provider.actions(results[0]).find((a) => a.role === 'primary')!.run()
    expect(serverRouteOf('t1')).toEqual({ section: 'services', params: { id: 'container:redis-cache' } })
    expect((await collect(provider, makeQuery('nginx')))[0].subtitle).toBe('service · Shop server')
  })

  it('returns nothing on an empty query and respects abort', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await collect(createSitesProvider(), makeQuery(''))).toEqual([])
    expect(await collect(createServicesProvider(), makeQuery('nginx'), controller.signal)).toEqual([])
  })
})
