import { testIpcContext } from '../../../services/server/testing/ipcContext'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { FakeRemoteExec } from '../../../services/server/testing/FakeRemoteExec'
import type { ServerIpcContext } from '../../../services/server/context'
import { tailJobLog } from './jobs'

function contextWith(fake: FakeRemoteExec | null): ServerIpcContext {
  return testIpcContext({ execFor: () => (fake ? fake.exec : null), broadcast: () => {} })
}

describe('tailJobLog', () => {
  it('runs the tail script over stdin and returns the output', async () => {
    const fake = new FakeRemoteExec().on('supervisorctl tail', { stdout: 'job done\n' })
    const result = await tailJobLog(contextWith(fake), 'conn-1', { kind: 'supervisor', process: 'web' })
    expect(result).toEqual({ success: true, data: 'job done\n' })
    expect(fake.calls[0].command).toBe('sh -s')
    expect(fake.calls[0].stdin).toContain("supervisorctl tail -65536 'web' stdout")
  })

  it('rejects targets outside the allow-list without touching the server', async () => {
    const fake = new FakeRemoteExec()
    const result = await tailJobLog(contextWith(fake), 'conn-1', { kind: 'file', path: '/etc/shadow' })
    expect(result.success).toBe(false)
    expect(fake.calls).toHaveLength(0)
  })

  it('reports errors and missing connections', async () => {
    const fake = new FakeRemoteExec().on('tail', { code: 1, stderr: 'sudo: a password is required' })
    expect(await tailJobLog(contextWith(fake), 'conn-1', { kind: 'cron', id: 'nightly' })).toEqual({ success: false, error: 'sudo: a password is required' })
    expect(await tailJobLog(contextWith(null), 'conn-1', { kind: 'cron', id: 'nightly' })).toEqual({ success: false, error: 'Not connected' })
    expect(await tailJobLog(contextWith(fake), 42, { kind: 'cron', id: 'nightly' })).toEqual({ success: false, error: 'Invalid connection' })
  })
})
