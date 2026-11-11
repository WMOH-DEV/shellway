import { describe, expect, it } from 'vitest'
import { parseInput } from './queryParser'

describe('parseInput', () => {
  it('keeps the chip scope without a prefix', () => {
    expect(parseInput('  orders ', 'tables')).toEqual({ text: 'orders', prefix: null, scope: 'tables' })
  })

  it.each([
    ['>export', '>', 'commands'],
    ['@main', '@', 'servers'],
    ['#orders', '#', 'tables'],
    ['/Order.php', '/', 'files'],
    ['?OrderRefunded', '?', 'files']
  ])('maps %s to its scope', (raw, prefix, scope) => {
    const parsed = parseInput(raw, 'all')
    expect(parsed.prefix).toBe(prefix)
    expect(parsed.scope).toBe(scope)
    expect(parsed.text).toBe(raw.slice(1))
  })

  it('returns empty text for a bare prefix', () => {
    expect(parseInput('# ', 'all')).toEqual({ text: '', prefix: '#', scope: 'tables' })
  })
})
