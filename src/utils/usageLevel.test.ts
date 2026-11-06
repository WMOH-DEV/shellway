import { describe, it, expect } from 'vitest'
import { usageLevel, temperatureLevel } from './usageLevel'

describe('usageLevel', () => {
  it.each([
    [0, 'success'],
    [69.9, 'success'],
    [70, 'warning'],
    [89.9, 'warning'],
    [90, 'error'],
    [100, 'error']
  ] as const)('%s%% is %s', (pct, expected) => {
    expect(usageLevel(pct)).toBe(expected)
  })
})

describe('temperatureLevel', () => {
  it.each([
    [59.9, 'success'],
    [60, 'warning'],
    [79.9, 'warning'],
    [80, 'error']
  ] as const)('%s C is %s', (celsius, expected) => {
    expect(temperatureLevel(celsius)).toBe(expected)
  })
})
