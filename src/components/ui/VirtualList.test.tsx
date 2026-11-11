import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VirtualList } from './VirtualList'

const items = Array.from({ length: 1000 }, (_, i) => `row-${i}`)

function renderList(scrollToIndex?: number) {
  return render(
    <VirtualList
      items={items}
      rowHeight={28}
      getKey={(item) => item}
      renderRow={(item) => <span>{item}</span>}
      scrollToIndex={scrollToIndex}
    />
  )
}

describe('VirtualList', () => {
  let original: PropertyDescriptor | undefined

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 280 })
  })

  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original)
  })

  it('renders only the rows in view plus overscan', () => {
    renderList()
    expect(screen.getByText('row-0')).toBeInTheDocument()
    expect(screen.queryByText('row-30')).toBeNull()
    expect(screen.getAllByText(/^row-/).length).toBeLessThanOrEqual(10 + 2 * 6)
  })

  it('scrolls a far row into the DOM', () => {
    renderList(500)
    expect(screen.getByText('row-500')).toBeInTheDocument()
    expect(screen.queryByText('row-0')).toBeNull()
  })
})
