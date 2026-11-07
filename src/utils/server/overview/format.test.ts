import { describe, expect, it } from 'vitest'
import { formatDownUp, formatRate, formatSize, formatUptime, formatUsage, keyValueLines, percentOf, toNumber } from './format'

const GB = 1024 ** 3
const MB = 1024 ** 2

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [-5, '0 B'],
    [512, '512 B'],
    [412 * MB, '412 MB'],
    [6.14 * GB, '6.1 GB'],
    [80 * GB, '80 GB']
  ])('%d bytes -> %s', (bytes, text) => {
    expect(formatSize(bytes)).toBe(text)
  })
})

describe('formatUsage', () => {
  it('uses the unit of the total for both numbers', () => {
    expect(formatUsage(66 * GB, 80 * GB)).toBe('66 of 80 GB')
    expect(formatUsage(4.9 * GB, 8 * GB)).toBe('4.9 of 8 GB')
    expect(formatUsage(300 * MB, 2 * GB)).toBe('0.3 of 2 GB')
  })
})

describe('formatRate and formatUptime', () => {
  it('formats a rate', () => {
    expect(formatRate(2.1 * MB)).toBe('2.1 MB/s')
  })

  it('formats download and upload in the unit of the larger one', () => {
    expect(formatDownUp(1.4 * MB, 0.7 * MB)).toBe('↓ 1.4 · ↑ 0.7 MB/s')
    expect(formatDownUp(0, 0)).toBe('↓ 0 · ↑ 0 B/s')
  })

  it.each([
    [25 * 86400 + 10 * 3600 + 5, '25 d 10 h'],
    [3 * 3600 + 120, '3 h 2 min'],
    [59, '0 min']
  ])('%d seconds -> %s', (seconds, text) => {
    expect(formatUptime(seconds)).toBe(text)
  })
})

describe('helpers', () => {
  it('clamps percentages and handles a zero total', () => {
    expect(percentOf(5, 10)).toBe(50)
    expect(percentOf(20, 10)).toBe(100)
    expect(percentOf(1, 0)).toBe(0)
  })

  it('reads key=value lines and numbers', () => {
    const values = keyValueLines('a=1\nnoise\nb = x=y\n')
    expect(values.get('a')).toBe('1')
    expect(values.get('b')).toBe('x=y')
    expect(toNumber('')).toBeNull()
    expect(toNumber('abc')).toBeNull()
    expect(toNumber('42')).toBe(42)
  })
})
