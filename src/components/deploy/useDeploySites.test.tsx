import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SiteSummary } from '@/types/deploy'
import { TabActiveContext } from '../tabActive'
import { useDeploySites } from './useDeploySites'

const autoSite = { config: { name: 'shop', sourceMode: 'auto' }, state: { busy: false, current: null } } as unknown as SiteSummary

let runnerInfo: ReturnType<typeof vi.fn>

function render(active: { value: boolean }) {
  const wrapper = ({ children }: { children: ReactNode }) => <TabActiveContext.Provider value={active.value}>{children}</TabActiveContext.Provider>
  return renderHook(() => useDeploySites('c1', 's1', true), { wrapper })
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

describe('useDeploySites while its tab is hidden', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    runnerInfo = vi.fn(async () => ({ success: true, data: { installed: true } }))
    Object.assign(window, {
      novadeck: {
        deploy: {
          runnerInfo,
          list: vi.fn(async () => ({ success: true, data: [autoSite] })),
          drift: vi.fn(async () => ({ success: true, data: null })),
          onChanged: () => () => {},
          onFinished: () => () => {}
        }
      }
    })
  })

  afterEach(() => vi.useRealTimers())

  it('stops checking the server while hidden and checks once when shown again', async () => {
    const active = { value: true }
    const { rerender } = render(active)
    await settle()
    expect(runnerInfo).toHaveBeenCalledTimes(1)

    active.value = false
    rerender()
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000) })
    expect(runnerInfo).toHaveBeenCalledTimes(1)

    active.value = true
    rerender()
    await settle()
    expect(runnerInfo).toHaveBeenCalledTimes(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(runnerInfo).toHaveBeenCalledTimes(3)
  })
})
