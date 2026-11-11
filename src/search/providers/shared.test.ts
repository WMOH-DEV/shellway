import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enabledProviders, createProviders } from './index'
import { AsyncQueue, createTtlCache, delay, formatRelative, mergeStreams } from './shared'

describe('AsyncQueue', () => {
  it('resolves a waiting pull when an item arrives', async () => {
    const queue = new AsyncQueue<number>()
    const signal = new AbortController().signal
    const pending = queue.pull(signal)
    queue.push(7)
    expect(await pending).toBe(7)
  })

  it('returns buffered items in order and undefined once aborted', async () => {
    const queue = new AsyncQueue<number>()
    const controller = new AbortController()
    queue.push(1)
    queue.push(2)
    expect(await queue.pull(controller.signal)).toBe(1)
    expect(await queue.pull(controller.signal)).toBe(2)
    const pending = queue.pull(controller.signal)
    controller.abort()
    expect(await pending).toBeUndefined()
  })
})

describe('mergeStreams', () => {
  async function* numbers(values: number[], pauseMs: number) {
    for (const value of values) {
      await new Promise((r) => setTimeout(r, pauseMs))
      yield value
    }
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('interleaves sources by arrival order', async () => {
    const out: number[] = []
    const run = (async () => {
      for await (const v of mergeStreams([numbers([1, 3], 10), numbers([2, 4], 15)])) out.push(v)
    })()
    await vi.advanceTimersByTimeAsync(100)
    await run
    expect(out).toEqual([1, 2, 3, 4])
  })

  it('finishes with no sources', async () => {
    const out: number[] = []
    for await (const v of mergeStreams<number>([])) out.push(v)
    expect(out).toEqual([])
  })
})

describe('createTtlCache', () => {
  it('reuses a value until it expires and drops failures', async () => {
    let clock = 0
    const load = vi.fn().mockResolvedValueOnce('a').mockRejectedValueOnce(new Error('x')).mockResolvedValue('c')
    const get = createTtlCache(100, load, () => clock)
    expect(await get('k')).toBe('a')
    expect(await get('k')).toBe('a')
    clock = 101
    await expect(get('k')).rejects.toThrow('x')
    expect(await get('k')).toBe('c')
    expect(load).toHaveBeenCalledTimes(3)
  })
})

describe('delay and formatRelative', () => {
  it('resolves early when aborted', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const done = vi.fn()
    void delay(1000, controller.signal).then(done)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(done).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it.each([
    [30_000, 'just now'],
    [5 * 60_000, '5m ago'],
    [3 * 3_600_000, '3h ago'],
    [2 * 86_400_000, '2d ago']
  ])('formats %i ms as %s', (age, expected) => {
    expect(formatRelative(1_000_000 - age, 1_000_000)).toBe(expected)
  })
})

describe('provider registry', () => {
  it('creates every provider with the documented ids', () => {
    const keys = createProviders().map((p) => `${p.id}:${p.kind}`)
    expect(keys).toEqual([
      'sessions:local',
      'tables:local',
      'queries:local',
      'history:local',
      'files:local',
      'files:remote',
      'sites:local',
      'services:local',
      'snippets:local',
      'commands:local',
      'settings:local'
    ])
  })

  it('drops a provider only when every one of its scopes is disabled', () => {
    const providers = createProviders()
    const ids = (disabled: Parameters<typeof enabledProviders>[1]) => enabledProviders(providers, disabled).map((p) => p.id)
    expect(ids(['tables'])).not.toContain('tables')
    expect(ids(['tables'])).toContain('sessions')
    expect(ids(['servers'])).not.toContain('sessions')
    expect(ids(['files'])).not.toContain('files')
    expect(ids(['commands'])).not.toContain('snippets')
    expect(ids(['commands'])).not.toContain('commands')
    expect(ids(['sites'])).not.toContain('services')
    expect(ids([])).toHaveLength(11)
  })
})
