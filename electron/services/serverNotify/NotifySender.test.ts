import { afterEach, describe, expect, it, vi } from 'vitest'
import { NOTIFY_TIMEOUT_MS, sendNotification, type FetchLike } from './NotifySender'

const SLACK = { kind: 'slack' as const, url: 'https://hooks.slack.com/services/T0/B0/secret-path' }

function fakeFetch(status = 200) {
  return vi.fn<FetchLike>(async () => new Response('ok', { status }))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('sendNotification', () => {
  it('posts the Slack body as JSON once', async () => {
    const fetch = fakeFetch()
    await sendNotification(SLACK, 'deploy-failed', 'Deploy failed', fetch)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe(SLACK.url)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(init?.redirect).toBe('error')
    expect(JSON.parse(init?.body as string)).toEqual({ text: 'Deploy failed' })
  })

  it('posts Discord content and generic webhook fields', async () => {
    const fetch = fakeFetch()
    await sendNotification({ kind: 'discord', url: 'https://discord.com/api/webhooks/1/x' }, 'test', 'Hi', fetch)
    await sendNotification({ kind: 'webhook', url: 'http://localhost:9000/hook' }, 'reboot-required', 'Reboot', fetch)
    expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({ content: 'Hi' })
    expect(JSON.parse(fetch.mock.calls[1][1]?.body as string)).toEqual({ source: 'shellway', event: 'reboot-required', text: 'Reboot' })
  })

  it('refuses plain http to a remote host without calling fetch', async () => {
    const fetch = fakeFetch()
    await expect(sendNotification({ kind: 'webhook', url: 'http://example.com/hook' }, 'test', 'x', fetch)).rejects.toThrow('https://')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports an HTTP error once, without retrying and without the address', async () => {
    const fetch = fakeFetch(500)
    const error = await sendNotification(SLACK, 'test', 'x', fetch).catch((err: Error) => err)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect((error as Error).message).toBe('The slack address answered with HTTP 500')
    expect((error as Error).message).not.toContain('secret-path')
  })

  it('hides network error details that could carry the address', async () => {
    const fetch = vi.fn<FetchLike>(async () => { throw new TypeError(`fetch failed for ${SLACK.url}`) })
    await expect(sendNotification(SLACK, 'test', 'x', fetch)).rejects.toThrow(/^Could not reach the slack address$/)
  })

  it('gives up after the timeout', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn<FetchLike>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const sending = sendNotification(SLACK, 'test', 'x', fetch).catch((err: Error) => err)
    await vi.advanceTimersByTimeAsync(NOTIFY_TIMEOUT_MS)
    expect(((await sending) as Error).message).toBe('The slack address did not answer within 5 seconds')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
