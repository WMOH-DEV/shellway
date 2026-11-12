import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }
  })
})

import { useConnectionStore } from '@/stores/connectionStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useSFTPPathStore } from '@/stores/sftpPathStore'
import type { RemoteSearchEvent } from '@/types/search'
import { applyPatch } from '../cachePatch'
import { useSearchCacheStore } from '../cacheClient'
import { useSearchIntentStore } from '../intentStore'
import { createFilesProvider } from './files'
import { createRemoteFilesProvider } from './remoteFiles'
import { useRemoteSearchStatus } from './remoteStatus'
import { collect, EMPTY_CONTEXT, makeQuery, makeSession, makeTab, resetSearchState, stubBrowser } from './testHelpers'

function seedPaths(paths: string[]): void {
  useSearchCacheStore.setState({
    snapshot: applyPatch(useSearchCacheStore.getState().snapshot!, { kind: 'paths', scopeId: 's1', paths }, 1)
  })
}

describe('local files provider', () => {
  let writeText: ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeText = stubBrowser().writeText
    resetSearchState()
    useSessionStore.setState({ sessions: [makeSession()] })
    seedPaths(['/var/www/shop/', '/var/www/shop/app/Models/Order.php', '/var/www/shop/composer.json'])
  })

  afterEach(() => vi.unstubAllGlobals())

  it('matches the base name and the path', async () => {
    const provider = createFilesProvider()
    const [order] = await collect(provider, makeQuery('order'))
    expect(order).toMatchObject({ id: 'file:s1:/var/www/shop/app/Models/Order.php', title: 'Order.php', icon: 'file' })
    expect(order.subtitle).toBe('/var/www/shop/app/Models · Shop server')
    expect((await collect(provider, makeQuery('app/models'))).map((r) => r.title)).toContain('Order.php')
  })

  it('treats trailing slash entries as folders', async () => {
    const [folder] = await collect(createFilesProvider(), makeQuery('shop'))
    expect(folder.icon).toBe('folder')
    expect(folder.title).toBe('shop')
    createFilesProvider().actions(folder)[0].run()
    expect(useSearchIntentStore.getState().pending.s1).toEqual([{ kind: 'sftp-reveal', path: '/var/www/shop/' }])
  })

  it('reveals, opens in the editor and copies the path', async () => {
    const provider = createFilesProvider()
    const [file] = await collect(provider, makeQuery('composer'))
    const actions = provider.actions(file)
    expect(actions.map((a) => a.role)).toEqual(['primary', 'secondary', 'copy'])
    actions[0].run()
    actions[1].run()
    actions[2].run()
    expect(useSearchIntentStore.getState().pending.s1).toEqual([
      { kind: 'sftp-reveal', path: '/var/www/shop/composer.json' },
      { kind: 'sftp-open', path: '/var/www/shop/composer.json' }
    ])
    expect(writeText).toHaveBeenCalledWith('/var/www/shop/composer.json')
  })

  it('offers no editor action for folders and nothing on an empty query', async () => {
    const provider = createFilesProvider()
    const [folder] = await collect(provider, makeQuery('shop'))
    expect(provider.actions(folder).map((a) => a.role)).toEqual(['primary', 'copy'])
    expect(await collect(provider, makeQuery(''))).toEqual([])
  })

  it('marks results of a closed server as disconnected', async () => {
    const [file] = await collect(createFilesProvider(), makeQuery('composer'))
    expect(file.scoreHints.disconnected).toBe(true)
    useConnectionStore.setState({ tabs: [makeTab()] })
    const [live] = await collect(createFilesProvider(), makeQuery('composer'))
    expect(live.scoreHints.disconnected).toBe(false)
  })
})

describe('remote files provider', () => {
  const listeners = new Set<(event: RemoteSearchEvent) => void>()
  const findFiles = vi.fn()
  const cancel = vi.fn()
  const emit = (event: RemoteSearchEvent) => listeners.forEach((l) => l(event))

  beforeEach(() => {
    vi.useFakeTimers()
    listeners.clear()
    findFiles.mockReset().mockResolvedValue({ searchId: 'search-1', command: "fd -i -g '*order*' in /var/www/shop" })
    cancel.mockReset().mockResolvedValue(undefined)
    stubBrowser({
      search: {
        findFiles,
        cancel,
        onEvent: (cb: (event: RemoteSearchEvent) => void) => {
          listeners.add(cb)
          return () => listeners.delete(cb)
        }
      },
      settings: {}
    })
    resetSearchState()
    useSessionStore.setState({ sessions: [makeSession({ defaultDirectory: '/home/deploy' })] })
    useConnectionStore.setState({ tabs: [makeTab()], activeTabId: 't1' })
    useSFTPPathStore.setState({ paths: { 's1:remote': '/var/www/shop' } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const connectedContext = { ...EMPTY_CONTEXT, activeTabId: 't1', activeSessionId: 's1', connectedTabIds: ['t1'] }

  async function runSearch(text: string, signal?: AbortSignal, wholeServer = false) {
    const provider = createRemoteFilesProvider()
    const pending = collect(provider, makeQuery(text, { context: connectedContext, wholeServer }), signal)
    await vi.advanceTimersByTimeAsync(250)
    return { pending, provider }
  }

  it('does nothing below two characters', async () => {
    const { pending } = await runSearch('o')
    expect(await pending).toEqual([])
    expect(findFiles).not.toHaveBeenCalled()
  })

  it('waits 250 ms, then streams paths from the search root', async () => {
    const provider = createRemoteFilesProvider()
    const pending = collect(provider, makeQuery('order', { context: connectedContext }))
    await vi.advanceTimersByTimeAsync(249)
    expect(findFiles).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(findFiles).toHaveBeenCalledWith({ connectionId: 't1', root: '/var/www/shop', text: 'order', excludes: expect.any(Array) })
    emit({ searchId: 'other', kind: 'files', paths: ['/ignored/order.txt'] })
    emit({ searchId: 'search-1', kind: 'files', paths: ['/var/www/shop/app/Models/Order.php'] })
    emit({ searchId: 'search-1', kind: 'done', truncated: false, timedOut: false })
    const results = await pending
    expect(results.map((r) => r.id)).toEqual(['file:s1:/var/www/shop/app/Models/Order.php'])
    expect(cancel).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })

  it('falls back to the session default directory when no path is stored', async () => {
    useSFTPPathStore.setState({ paths: {} })
    const { pending } = await runSearch('order')
    await vi.advanceTimersByTimeAsync(0)
    expect(findFiles.mock.calls[0][0].root).toBe('/home/deploy')
    emit({ searchId: 'search-1', kind: 'done', truncated: false, timedOut: false })
    await pending
  })

  it('searches the home folder when no folder is known and says so', async () => {
    useSFTPPathStore.setState({ paths: {} })
    useSessionStore.setState({ sessions: [makeSession({ defaultDirectory: undefined })] })
    const { pending } = await runSearch('order')
    await vi.advanceTimersByTimeAsync(0)
    expect(findFiles).toHaveBeenCalledTimes(1)
    expect(findFiles.mock.calls[0][0].root).toBeUndefined()
    expect(useRemoteSearchStatus.getState().folder).toBe('~')
    emit({ searchId: 'search-1', kind: 'done', truncated: false, timedOut: false })
    expect(await pending).toEqual([])
  })

  it('reports the folder it searched', async () => {
    const { pending } = await runSearch('order')
    await vi.advanceTimersByTimeAsync(0)
    expect(useRemoteSearchStatus.getState()).toMatchObject({ folder: '/var/www/shop', server: 'Shop server' })
    emit({ searchId: 'search-1', kind: 'done', truncated: false, timedOut: false })
    await pending
  })

  it('searches from the server root when asked to search the whole server', async () => {
    const { pending } = await runSearch('order', undefined, true)
    await vi.advanceTimersByTimeAsync(0)
    expect(findFiles.mock.calls[0][0].root).toBe('/')
    expect(useRemoteSearchStatus.getState().folder).toBe('/')
    emit({ searchId: 'search-1', kind: 'done', truncated: false, timedOut: false })
    await pending
  })

  it('cancels the remote search when aborted', async () => {
    const controller = new AbortController()
    const { pending } = await runSearch('order', controller.signal)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await pending
    expect(cancel).toHaveBeenCalledWith('search-1')
  })

  it('never aborts before the delay by calling the server', async () => {
    const controller = new AbortController()
    const provider = createRemoteFilesProvider()
    const pending = collect(provider, makeQuery('order', { context: connectedContext }), controller.signal)
    controller.abort()
    await vi.advanceTimersByTimeAsync(300)
    expect(await pending).toEqual([])
    expect(findFiles).not.toHaveBeenCalled()
  })

  it('searches only the active server when the filter is current', async () => {
    useConnectionStore.setState({ tabs: [makeTab(), makeTab({ id: 't2', sessionId: 's2' })] })
    const provider = createRemoteFilesProvider()
    const context = { ...connectedContext, connectedTabIds: ['t1', 't2'] }
    const pending = collect(provider, makeQuery('order', { context, serverFilter: 'current' }))
    await vi.advanceTimersByTimeAsync(250)
    emit({ searchId: 'search-1', kind: 'done', truncated: false, timedOut: false })
    await pending
    expect(findFiles).toHaveBeenCalledTimes(1)
    expect(findFiles.mock.calls[0][0].connectionId).toBe('t1')
  })

  it('stops after 50 results and cancels the rest', async () => {
    const { pending } = await runSearch('order')
    await vi.advanceTimersByTimeAsync(0)
    emit({ searchId: 'search-1', kind: 'files', paths: Array.from({ length: 120 }, (_, i) => `/var/www/shop/order-${i}.php`) })
    expect(await pending).toHaveLength(50)
    expect(cancel).toHaveBeenCalledWith('search-1')
  })
})
