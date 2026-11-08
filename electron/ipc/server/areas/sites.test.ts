import { testIpcContext } from '../../../services/server/testing/ipcContext'
import { describe, expect, it, vi } from 'vitest'
import { FakeRemoteExec } from '../../../services/server/testing/FakeRemoteExec'
import type { ServerIpcContext } from '../../../services/server/context'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { tailSiteLog } = await import('./sites')

const contextWith = (fake: FakeRemoteExec | null): ServerIpcContext => testIpcContext({ execFor: () => fake?.exec ?? null, broadcast: () => {} })

describe('server:sites:tail', () => {
  it('runs one bounded tail over stdin and returns the text', async () => {
    const fake = new FakeRemoteExec().on('laravel.log', { stdout: '[2026-11-07] production.INFO: ok\n' })
    const result = await tailSiteLog(contextWith(fake), 'c1', { site: 'app', source: 'app', file: 'storage/logs/laravel.log', lines: 100 })
    expect(result).toEqual({ success: true, data: { state: 'ok', text: '[2026-11-07] production.INFO: ok\n' } })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].command).toBe('sh -s')
    expect(fake.calls[0].stdin).toContain('tail -n 100')
  })

  it('rejects a path outside the allow-list without touching the server', async () => {
    const fake = new FakeRemoteExec()
    const result = await tailSiteLog(contextWith(fake), 'c1', { site: 'app', source: 'error', file: '/etc/shadow' })
    expect(result).toEqual({ success: false, error: 'This log file is not allowed' })
    expect(fake.calls).toHaveLength(0)
  })

  it('reports a missing connection', async () => {
    const result = await tailSiteLog(contextWith(null), 'c1', { site: 'app', source: 'error', file: '/var/log/nginx/error.log' })
    expect(result).toEqual({ success: false, error: 'Not connected to this server' })
  })
})
