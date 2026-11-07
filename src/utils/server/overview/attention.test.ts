import { describe, expect, it } from 'vitest'
import type { AttentionItem, AttentionLevel } from '@/types/server/core'
import { rankAttention, worstLevel } from './attention'

const item = (id: string, level: AttentionLevel, rank: number, title = id): AttentionItem => ({
  id,
  area: 'overview',
  level,
  rank,
  title,
  detail: '',
  actionLabel: 'Open',
  route: { section: 'overview' }
})

describe('rankAttention', () => {
  it.each<[string, AttentionItem[], string[]]>([
    ['higher rank first', [item('updates', 'info', 20), item('deploy', 'error', 150), item('disk', 'warning', 72)], ['deploy', 'disk', 'updates']],
    ['same rank: worse level first', [item('a', 'warning', 60), item('b', 'error', 60)], ['b', 'a']],
    ['same rank and level: by title', [item('x', 'info', 10, 'Zeta'), item('y', 'info', 10, 'Alpha')], ['y', 'x']],
    ['duplicate ids keep one', [item('disk', 'warning', 70), item('disk', 'warning', 70)], ['disk']],
    ['empty list', [], []]
  ])('%s', (_name, items, order) => {
    expect(rankAttention(items).map((i) => i.id)).toEqual(order)
  })
})

describe('worstLevel', () => {
  it('returns the most severe level or null', () => {
    expect(worstLevel([item('a', 'info', 1), item('b', 'warning', 50)])).toBe('warning')
    expect(worstLevel([item('a', 'info', 1), item('b', 'error', 100)])).toBe('error')
    expect(worstLevel([])).toBeNull()
  })
})
