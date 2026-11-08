import { describe, expect, it } from 'vitest'
import { contrastWithWhite, solidAccent } from './appearance'

const channels = (value: string): [number, number, number] => value.split(' ').map(Number) as [number, number, number]

describe('solidAccent', () => {
  it.each(['#3b82f6', '#eab308', '#22c55e', '#06b6d4', '#ec4899'])('makes %s dark enough for white text, hover included', (hex) => {
    const { solid, hover } = solidAccent(hex)
    expect(contrastWithWhite(channels(solid))).toBeGreaterThanOrEqual(4.5)
    expect(contrastWithWhite(channels(hover))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps a color that already passes and darkens the hover one step', () => {
    expect(solidAccent('#1e3a8a')).toEqual({ solid: '30 58 138', hover: '29 55 131' })
  })

  it('darkens only as far as needed', () => {
    expect(contrastWithWhite(channels(solidAccent('#3b82f6').solid))).toBeLessThan(5)
  })
})
