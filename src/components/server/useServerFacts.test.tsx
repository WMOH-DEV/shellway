import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scanFacts, useServerFactsStore } from '@/stores/serverFactsStore'
import type { ProbeResult } from '@/types/server/core'
import { emitFacts, installFakeServer } from './action/testServer'
import { useServerFacts } from './useServerFacts'

const ok = (data: unknown): ProbeResult => ({ status: 'ok', data, at: 1 })

beforeEach(() => useServerFactsStore.setState({ byConnection: {} }))

describe('useServerFacts', () => {
  it('scans the requested probes when active and returns only those facts', async () => {
    const server = installFakeServer({ scan: vi.fn().mockResolvedValue({ success: true, data: { 'core.os': ok('ubuntu'), 'core.disk': ok(10) } }) })
    const { result } = renderHook(() => useServerFacts({ connectionId: 'conn-1', active: true }, ['core.os']))
    await waitFor(() => expect(result.current.facts).toEqual({ 'core.os': ok('ubuntu') }))
    expect(server.scan).toHaveBeenCalledWith('conn-1', ['core.os'], false)
    expect(result.current.loading).toBe(false)
  })

  it('does not scan while inactive', () => {
    const server = installFakeServer()
    renderHook(() => useServerFacts({ connectionId: 'conn-1', active: false }, ['core.os']))
    expect(server.scan).not.toHaveBeenCalled()
  })

  it('reflects facts pushed by the engine for its connection only', async () => {
    installFakeServer()
    const { result } = renderHook(() => useServerFacts({ connectionId: 'conn-1', active: false }, ['software.redis']))
    emitFacts('conn-2', { 'software.redis': ok('other') })
    expect(result.current.facts).toEqual({})
    emitFacts('conn-1', { 'software.redis': ok('7.2'), 'software.php': ok('8.3') })
    expect(result.current.facts).toEqual({ 'software.redis': ok('7.2') })
  })

  it('forces a fresh scan on refresh and reports errors', async () => {
    const scan = vi.fn().mockResolvedValue({ success: false, error: 'Not connected' })
    installFakeServer({ scan })
    const { result } = renderHook(() => useServerFacts({ connectionId: 'conn-1', active: false }, ['core.os']))
    await act(() => result.current.refresh())
    expect(scan).toHaveBeenCalledWith('conn-1', ['core.os'], true)
    expect(result.current.error).toBe('Not connected')
  })
})

describe('scanFacts', () => {
  it('shares one request between concurrent scans of the same probes', async () => {
    let finish: (value: unknown) => void = () => {}
    const scan = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    installFakeServer({ scan })
    const first = scanFacts('conn-1', ['b', 'a'], false)
    const second = scanFacts('conn-1', ['a', 'b'], false)
    expect(scan).toHaveBeenCalledTimes(1)
    finish({ success: true, data: { a: ok(1) } })
    await expect(first).resolves.toEqual(await second)
    expect(useServerFactsStore.getState().byConnection['conn-1']).toEqual({ a: ok(1) })
    void scanFacts('conn-1', ['a', 'b'], false)
    expect(scan).toHaveBeenCalledTimes(2)
  })

  it('turns a failed call into an error result', async () => {
    installFakeServer({ scan: vi.fn().mockRejectedValue(new Error('No handler registered')) })
    await expect(scanFacts('conn-1', ['a'], true)).resolves.toEqual({ success: false, error: 'No handler registered' })
  })
})
