import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFitScrollParent } from './useFitScrollParent'

let notify: () => void = () => {}

function Probe({ onHeight }: { onHeight(height: number | undefined): void }) {
  const ref = useRef<HTMLDivElement>(null)
  onHeight(useFitScrollParent(ref, 32))
  return (
    <div data-testid="scroller" style={{ overflowY: 'auto' }}>
      <div><div ref={ref} /></div>
    </div>
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('useFitScrollParent', () => {
  it('caps at the nearest scrolling parent height minus the gap, and follows resizes', () => {
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { notify = cb } observe() {} disconnect() {} })
    const heights: (number | undefined)[] = []
    const { getByTestId } = render(<Probe onHeight={(h) => heights.push(h)} />)
    const scroller = getByTestId('scroller')

    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 400 })
    act(() => notify())
    expect(heights.at(-1)).toBe(368)

    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 20 })
    act(() => notify())
    expect(heights.at(-1)).toBe(0)
  })
})
