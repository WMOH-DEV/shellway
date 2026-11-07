import { beforeEach, describe, expect, it } from 'vitest'
import { computePosition } from './SearchSelectPosition'

function trigger(left: number, top: number, width = 200, height = 32): HTMLElement {
  const element = document.createElement('button')
  element.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) })
  return element
}

beforeEach(() => {
  window.innerWidth = 1000
  window.innerHeight = 800
})

describe('computePosition', () => {
  it('grows to the right from a trigger in the left half', () => {
    expect(computePosition(trigger(100, 100), 200)).toEqual({ left: 100, maxWidth: 892, minWidth: 200, top: 136 })
  })

  it('grows to the left from a trigger in the right half so it stays on screen', () => {
    expect(computePosition(trigger(700, 100), 200)).toEqual({ right: 100, maxWidth: 892, minWidth: 200, top: 136 })
  })

  it('opens above when there is no room below', () => {
    expect(computePosition(trigger(100, 700), 300)).toMatchObject({ bottom: 104 })
  })
})
