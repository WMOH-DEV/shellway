import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import { useWithOsFamily } from './useWithOsFamily'

function withPrefs(prefs: ReturnType<typeof vi.fn>) {
  mockNovadeck({ 'server.settings.prefs': prefs })
  return renderHook(() => useWithOsFamily('session-1')).result
}

const saved = (osFamily: string) => vi.fn(async () => ({ success: true, data: { deployUser: '', osFamily } }))

describe('useWithOsFamily', () => {
  it('leaves params alone when the OS is detected', async () => {
    expect(await withPrefs(saved('auto')).current({ component: 'nginx' })).toEqual({ component: 'nginx' })
  })

  it('reads the saved OS family when the install is clicked, so a click before the page loaded still uses it', async () => {
    const prefs = saved('debian')
    const result = withPrefs(prefs)
    expect(prefs).not.toHaveBeenCalled()
    expect(await result.current({ component: 'nginx' })).toEqual({ component: 'nginx', osFamily: 'debian' })
    expect(prefs).toHaveBeenCalledWith('session-1')
  })

  it('falls back to the detected OS when the saved settings cannot be read', async () => {
    expect(await withPrefs(vi.fn(async () => { throw new Error('gone') })).current({ component: 'nginx' })).toEqual({ component: 'nginx' })
  })
})
