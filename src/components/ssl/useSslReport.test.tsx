import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockNovadeck } from '@/test/novadeck'
import { makeReport } from '@/utils/ssl/testReport'
import { useSslReport } from './useSslReport'

describe('useSslReport', () => {
  it('does nothing while disconnected', () => {
    const check = vi.fn()
    mockNovadeck({ 'ssl.check': check })
    renderHook(() => useSslReport('c1', 's1', false))
    expect(check).not.toHaveBeenCalled()
  })

  it('loads once on connect and never polls', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const check = vi.fn().mockResolvedValue({ success: true, data: makeReport() })
    mockNovadeck({ 'ssl.check': check })
    const { result } = renderHook(() => useSslReport('c1', 's1', true))
    await waitFor(() => expect(result.current.report).not.toBeNull())
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
    expect(check).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledWith('c1', 's1')
    vi.useRealTimers()
  })

  it('coalesces concurrent refreshes into one follow-up check', async () => {
    const pending: Array<(value: unknown) => void> = []
    const check = vi.fn(() => new Promise((resolve) => { pending.push(resolve) }))
    mockNovadeck({ 'ssl.check': check })
    const { result } = renderHook(() => useSslReport('c1', 's1', true))
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1))

    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.refresh()
      second = result.current.refresh()
    })
    expect(first).toBe(second)
    expect(check).toHaveBeenCalledTimes(1)

    await act(async () => { pending[0]({ success: true, data: makeReport() }) })
    await waitFor(() => expect(check).toHaveBeenCalledTimes(2))
    await act(async () => { pending[1]({ success: true, data: makeReport() }); await first })
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('reports an error and keeps the previous report', async () => {
    const check = vi.fn()
      .mockResolvedValueOnce({ success: true, data: makeReport() })
      .mockResolvedValueOnce({ success: false, error: 'ssh dropped' })
    mockNovadeck({ 'ssl.check': check })
    const { result } = renderHook(() => useSslReport('c1', 's1', true))
    await waitFor(() => expect(result.current.report).not.toBeNull())
    await act(async () => { await result.current.refresh() })
    expect(result.current.error).toBe('ssh dropped')
    expect(result.current.report).not.toBeNull()
  })

  it('reports an error when there is no report yet', async () => {
    mockNovadeck({ 'ssl.check': vi.fn().mockRejectedValue(new Error('IPC failed')) })
    const { result } = renderHook(() => useSslReport('c1', 's1', true))
    await waitFor(() => expect(result.current.error).toBe('IPC failed'))
    expect(result.current.report).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})
