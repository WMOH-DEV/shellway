import { testIpcContext } from '../../../services/server/testing/ipcContext'
import type { Readable } from 'stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeRemoteExec } from '../../../services/server/testing/FakeRemoteExec'
import type { RemoteExec } from '../../../services/deploy/DeployService'
import { createLogStreams } from './services'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const NGINX = { kind: 'systemd', name: 'nginx' }

function context(exec: RemoteExec | null) {
  const broadcast = vi.fn()
  return { ctx: testIpcContext({ execFor: () => exec, broadcast }), broadcast }
}

interface Pending {
  stdin: Readable
  onOutput?: (chunk: string) => void
  resolve(code: number): void
}

function streamingExec() {
  const pending: Pending[] = []
  const exec: RemoteExec = (_command, options = {}) => new Promise((resolve) => {
    const entry: Pending = {
      stdin: options.stdin as Readable,
      onOutput: options.onOutput,
      resolve: (code) => resolve({ stdout: '', stdoutBytes: 0, stderr: '', code })
    }
    entry.stdin.on('end', () => entry.resolve(143))
    entry.stdin.resume()
    pending.push(entry)
  })
  return { exec, pending }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createLogStreams.read', () => {
  it('returns the last N lines', async () => {
    const fake = new FakeRemoteExec().on('journalctl', { stdout: 'a\nb\nc\n' })
    const { ctx } = context(fake.exec)
    expect(await createLogStreams(ctx).read('c1', NGINX, 2)).toEqual({ success: true, data: { lines: ['b', 'c'], missing: false } })
    expect(fake.calls[0].command).toMatch(/^sh -c /)
  })

  it('reports a missing log file', async () => {
    const fake = new FakeRemoteExec().on('tail', { stdout: '@@missing\n' })
    const { ctx } = context(fake.exec)
    expect(await createLogStreams(ctx).read('c1', { kind: 'system', id: 'nginx-error' }, 10)).toEqual({ success: true, data: { lines: [], missing: true } })
  })

  it('returns stderr when the command fails without output', async () => {
    const fake = new FakeRemoteExec().on('journalctl', { stderr: 'No journal files were found.', code: 1 })
    const { ctx } = context(fake.exec)
    expect(await createLogStreams(ctx).read('c1', NGINX, 10)).toEqual({ success: false, error: 'No journal files were found.' })
  })

  it('rejects unknown sources and a missing connection without running anything', async () => {
    const fake = new FakeRemoteExec()
    const streams = createLogStreams(context(fake.exec).ctx)
    expect((await streams.read('c1', { kind: 'file', path: '/etc/shadow' }, 10)).success).toBe(false)
    expect(fake.calls).toHaveLength(0)
    expect(await createLogStreams(context(null).ctx).read('c1', NGINX, 10)).toEqual({ success: false, error: 'Not connected' })
  })
})

describe('createLogStreams.follow', () => {
  it('pushes output in batches and ends as stopped when asked', async () => {
    vi.useFakeTimers()
    const { exec, pending } = streamingExec()
    const { ctx, broadcast } = context(exec)
    const streams = createLogStreams(ctx)
    const started = streams.follow('c1', 'tab-1', NGINX)
    if (!started.success) throw new Error(started.error)
    pending[0].onOutput?.('line one\n')
    pending[0].onOutput?.('line two\n')
    vi.advanceTimersByTime(200)
    expect(broadcast).toHaveBeenCalledWith('server:services:logs-chunk', started.data.followId, 'line one\nline two\n')
    streams.stop(started.data.followId)
    await vi.runAllTimersAsync()
    expect(broadcast).toHaveBeenLastCalledWith('server:services:logs-end', started.data.followId, { reason: 'stopped', message: 'Stopped.' })
  })

  it('keeps one follower per tab', async () => {
    const { exec, pending } = streamingExec()
    const { ctx, broadcast } = context(exec)
    const streams = createLogStreams(ctx)
    const first = streams.follow('c1', 'tab-1', NGINX)
    const second = streams.follow('c1', 'tab-1', { kind: 'system', id: 'syslog' })
    if (!first.success || !second.success) throw new Error('follow failed')
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledWith('server:services:logs-end', first.data.followId, { reason: 'stopped', message: 'Stopped.' }))
    expect(pending).toHaveLength(2)
    expect(pending[1].stdin.readableEnded).toBe(false)
  })

  it('lets a tab switch its live log when the limit is reached, but refuses a new tab', () => {
    const { exec } = streamingExec()
    const { ctx } = context(exec)
    const streams = createLogStreams(ctx)
    for (let i = 0; i < 8; i++) expect(streams.follow('c1', `tab-${i}`, NGINX).success).toBe(true)
    expect(streams.follow('c1', 'tab-0', { kind: 'system', id: 'syslog' }).success).toBe(true)
    expect(streams.follow('c1', 'tab-new', NGINX).success).toBe(false)
  })

  it('reports a missing log and a dropped connection', async () => {
    const { exec, pending } = streamingExec()
    const { ctx, broadcast } = context(exec)
    const streams = createLogStreams(ctx)
    const started = streams.follow('c1', 'tab-1', { kind: 'system', id: 'php-fpm' })
    if (!started.success) throw new Error(started.error)
    pending[0].onOutput?.('@@missing\n')
    pending[0].resolve(0)
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledWith('server:services:logs-end', started.data.followId, expect.objectContaining({ reason: 'missing' })))
  })

  it('validates the tab and source', () => {
    const streams = createLogStreams(context(streamingExec().exec).ctx)
    expect(streams.follow('c1', '', NGINX).success).toBe(false)
    expect(streams.follow('c1', 'tab-1', { kind: 'system', id: 'x' }).success).toBe(false)
  })
})
