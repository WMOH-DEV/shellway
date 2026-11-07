import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import { useWithOsFamily } from './useWithOsFamily'

function withPrefs(osFamily: string) {
  mockNovadeck({ 'server.settings.prefs': vi.fn(async () => ({ success: true, data: { deployUser: '', osFamily } })) })
  return renderHook(() => useWithOsFamily('session-1'))
}

describe('useWithOsFamily', () => {
  it('leaves params alone when the OS is detected', async () => {
    const { result } = withPrefs('auto')
    await waitFor(() => expect(window.novadeck.server.settings.prefs).toHaveBeenCalled())
    expect(result.current({ component: 'nginx' })).toEqual({ component: 'nginx' })
  })

  it('adds the chosen OS family to install params', async () => {
    const { result } = withPrefs('debian')
    await waitFor(() => expect(result.current({ component: 'nginx' })).toEqual({ component: 'nginx', osFamily: 'debian' }))
  })
})
