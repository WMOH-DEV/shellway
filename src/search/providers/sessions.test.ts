import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useUIStore } from '@/stores/uiStore'
import { createSessionsProvider } from './sessions'
import { collect, makeQuery, makeSession, makeTab, resetSearchState, stubBrowser } from './testHelpers'

describe('sessions provider', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = stubBrowser().writeText
    resetSearchState()
    useSessionStore.setState({
      sessions: [
        makeSession({ id: 's1', name: 'Shop server', host: 'shop.example.com', group: 'Clients', lastConnected: Date.now() - 1000 }),
        makeSession({ id: 's2', name: 'Blog', host: 'blog.example.com', username: 'root', lastConnected: Date.now() - 5_000_000 }),
        makeSession({ id: 's3', name: 'Staging', host: 'staging.example.com' })
      ]
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('matches name, host, username and group', async () => {
    const provider = createSessionsProvider()
    expect((await collect(provider, makeQuery('shop'))).map((r) => r.id)).toEqual(['session:s1'])
    expect((await collect(provider, makeQuery('blog.example'))).map((r) => r.id)).toEqual(['session:s2'])
    expect((await collect(provider, makeQuery('root'))).map((r) => r.id)).toEqual(['session:s2'])
    expect((await collect(provider, makeQuery('clients'))).map((r) => r.id)).toEqual(['session:s1'])
  })

  it('formats the subtitle with user, host, port and group', async () => {
    const [result] = await collect(createSessionsProvider(), makeQuery('shop'))
    expect(result.subtitle).toBe('deploy@shop.example.com:22 · Clients')
    expect(result.icon).toBe('server')
  })

  it('shows connected and tab open hints', async () => {
    useConnectionStore.setState({ tabs: [makeTab({ id: 't1', sessionId: 's1' }), makeTab({ id: 't2', sessionId: 's2', status: 'connecting' })] })
    const provider = createSessionsProvider()
    expect((await collect(provider, makeQuery('shop')))[0].hint).toBe('connected')
    expect((await collect(provider, makeQuery('blog')))[0].hint).toBe('tab open')
    expect((await collect(provider, makeQuery('staging')))[0].hint).toBeUndefined()
  })

  it('suggests the most recently connected sessions on an empty query', async () => {
    const results = await collect(createSessionsProvider(), makeQuery(''))
    expect(results.map((r) => r.id)).toEqual(['session:s1', 'session:s2'])
  })

  it('returns at most 50 results and honours an aborted signal', async () => {
    useSessionStore.setState({ sessions: Array.from({ length: 80 }, (_, i) => makeSession({ id: `x${i}`, name: `Node ${i}` })) })
    const provider = createSessionsProvider()
    expect(await collect(provider, makeQuery('node'))).toHaveLength(50)
    const controller = new AbortController()
    controller.abort()
    expect(await collect(provider, makeQuery('node'), controller.signal)).toEqual([])
  })

  it('opens the existing tab or requests a connection', async () => {
    const provider = createSessionsProvider()
    const [closed] = await collect(provider, makeQuery('blog'))
    provider.actions(closed).find((a) => a.role === 'primary')!.run()
    expect(useUIStore.getState().connectSessionId).toBe('s2')

    useConnectionStore.setState({ tabs: [makeTab({ id: 't1', sessionId: 's1', activeSubTab: 'terminal' })], activeTabId: null })
    const [open] = await collect(provider, makeQuery('shop'))
    provider.actions(open).find((a) => a.role === 'secondary')!.run()
    expect(useConnectionStore.getState().tabs[0].activeSubTab).toBe('sftp')
    expect(useConnectionStore.getState().activeTabId).toBe('t1')
  })

  it('copies the host', async () => {
    const provider = createSessionsProvider()
    const [result] = await collect(provider, makeQuery('shop'))
    provider.actions(result).find((a) => a.role === 'copy')!.run()
    expect(writeText).toHaveBeenCalledWith('shop.example.com')
  })
})
