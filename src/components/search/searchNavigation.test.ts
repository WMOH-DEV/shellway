import { describe, expect, it } from 'vitest'
import type { GroupedResults } from '@/search/ranking'
import type { ScoredResult } from '@/search/types'
import { buildListItems, buildSections, sectionRows, stepGroup, wrapIndex } from './searchNavigation'

function scored(id: string, providerId: ScoredResult['providerId']): ScoredResult {
  return { id, providerId, title: id, subtitle: '', icon: 'table', scoreHints: {}, payload: null, score: 1 }
}

const grouped: GroupedResults = {
  best: scored('best', 'tables'),
  groups: [
    { providerId: 'tables', label: 'Tables', results: [scored('t1', 'tables'), scored('t2', 'tables')], overflow: 3 },
    { providerId: 'files', label: 'Files', results: [scored('f1', 'files')], overflow: 0 }
  ],
  total: 4
}

describe('searchNavigation', () => {
  it('puts the best match first and numbers rows across sections', () => {
    const sections = buildSections(grouped)
    expect(sections.map((s) => [s.label, s.start])).toEqual([
      ['Best match', 0],
      ['Tables', 1],
      ['Files', 3]
    ])
    expect(sectionRows(sections).map((r) => r.id)).toEqual(['best', 't1', 't2', 'f1'])
  })

  it('interleaves a header before each section in the list items', () => {
    const items = buildListItems(buildSections(grouped))
    expect(items.map((i) => i.kind)).toEqual(['header', 'row', 'header', 'row', 'row', 'header', 'row'])
  })

  it('skips empty groups', () => {
    expect(buildSections({ best: null, groups: [], total: 0 })).toEqual([])
  })

  it('wraps the index in both directions', () => {
    expect(wrapIndex(4, 3, 1)).toBe(0)
    expect(wrapIndex(4, 0, -1)).toBe(3)
    expect(wrapIndex(0, 0, 1)).toBe(0)
  })

  it('steps to the first row of the next or previous group with wrap', () => {
    const sections = buildSections(grouped)
    expect(stepGroup(sections, 0, 1)).toBe(1)
    expect(stepGroup(sections, 2, 1)).toBe(3)
    expect(stepGroup(sections, 3, 1)).toBe(0)
    expect(stepGroup(sections, 0, -1)).toBe(3)
    expect(stepGroup(sections, 2, -1)).toBe(0)
  })
})
