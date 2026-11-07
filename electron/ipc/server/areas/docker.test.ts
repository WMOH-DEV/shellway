import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRemoteExec } from '../../../services/server/testing/FakeRemoteExec'
import { MANIFEST_SINGLE } from '../../../../src/utils/server/docker/fixtures/output'

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) } }))

const { DOCKER_LOGS_DATA, DOCKER_LOGS_END, registerDockerIPC } = await import('./docker')

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('docker area IPC', () => {
  let fake: FakeRemoteExec
  let broadcast: ReturnType<typeof vi.fn>

  beforeEach(() => {
    handlers.clear()
    fake = new FakeRemoteExec()
    broadcast = vi.fn()
    registerDockerIPC({ execFor: (id) => (id === 'conn-1' ? fake.exec : null), broadcast })
  })

  it('streams container logs and reports the end', async () => {
    fake.on('docker logs', { stdout: '2026-11-07T10:00:00Z ready\n' })
    const result = await call('server:docker:logs-start', 'conn-1', 'tab-1', 'web', true)
    expect(result).toEqual({ success: true, data: 'tab-1#1' })
    await flush()
    expect(fake.calls[0].command).toContain('docker logs --timestamps --tail 200 -f web')
    expect(fake.calls[0].stdin).toBe('[stream]')
    expect(broadcast).toHaveBeenCalledWith(DOCKER_LOGS_DATA, 'tab-1#1', '2026-11-07T10:00:00Z ready\n')
    expect(broadcast).toHaveBeenCalledWith(DOCKER_LOGS_END, 'tab-1#1', null)
  })

  it('omits -f for a one-off read', async () => {
    await call('server:docker:logs-start', 'conn-1', 'tab-1', 'web', false)
    expect(fake.calls[0].command).not.toContain(' -f ')
  })

  it('rejects unsafe container names', async () => {
    const result = await call('server:docker:logs-start', 'conn-1', 'tab-1', 'web; rm -rf /', true)
    expect(result).toMatchObject({ success: false })
    expect(fake.calls).toHaveLength(0)
  })

  it('fails when the server is not connected', async () => {
    expect(await call('server:docker:logs-start', 'conn-2', 'tab-1', 'web', true)).toEqual({ success: false, error: 'The server is not connected' })
  })

  it('reports a timeout in plain words', async () => {
    fake.on('docker logs', new Error('Command timed out after 1800000ms'))
    await call('server:docker:logs-start', 'conn-1', 'tab-1', 'web', true)
    await flush()
    expect(broadcast).toHaveBeenCalledWith(DOCKER_LOGS_END, 'tab-1#1', 'Stopped after 30 minutes. Start again to keep following.')
  })

  it('checks an image tag', async () => {
    fake.on('docker manifest inspect', { stdout: MANIFEST_SINGLE })
    expect(await call('server:docker:manifest', 'conn-1', 'acme/api:2.1')).toEqual({ success: true, data: { found: true, size: 84_000_000, platforms: 1, message: 'found' } })
    expect(fake.calls[0].command).toBe('docker manifest inspect acme/api:2.1')
  })

  it('reports a missing tag', async () => {
    fake.on('docker manifest inspect', { stderr: 'no such manifest: docker.io/acme/api:9.9', code: 1 })
    expect(await call('server:docker:manifest', 'conn-1', 'acme/api:9.9')).toMatchObject({ success: true, data: { found: false } })
  })

  it('rejects an invalid image reference', async () => {
    expect(await call('server:docker:manifest', 'conn-1', 'acme/api:$(id)')).toMatchObject({ success: false })
  })
})
