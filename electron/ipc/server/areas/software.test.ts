import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { FakeRemoteExec } from '../../../services/server/testing/FakeRemoteExec'
import { searchPackages } from './software'

describe('searchPackages', () => {
  it('runs one bounded search and parses the hits', async () => {
    const fake = new FakeRemoteExec().on('apt-cache search', { stdout: '@@results\nhtop - interactive processes viewer\n@@installed\n' })
    const result = await searchPackages(fake.exec, 'htop')
    expect(result).toEqual({ success: true, data: [{ name: 'htop', description: 'interactive processes viewer', installed: false }] })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0].stdin).toContain('head -n 50')
  })

  it('refuses short or unsafe queries without touching the server', async () => {
    const fake = new FakeRemoteExec()
    expect((await searchPackages(fake.exec, 'ab')).success).toBe(false)
    expect((await searchPackages(fake.exec, '$(reboot)')).success).toBe(false)
    expect(fake.calls).toHaveLength(0)
  })

  it('reports servers without apt', async () => {
    const fake = new FakeRemoteExec().on('apt-cache', { stdout: '@@unsupported\n' })
    expect(await searchPackages(fake.exec, 'redis')).toEqual({ success: false, error: expect.stringContaining('apt') })
  })
})
