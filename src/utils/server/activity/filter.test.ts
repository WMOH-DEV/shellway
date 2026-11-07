import { describe, expect, it } from 'vitest'
import { ACTIVITY_PAGE_SIZE, countFailed, matchesView, mergeEntries, oldestAt, toActivityQuery } from './filter'
import { activityEntry } from './fixtures/activityEntry'

describe('toActivityQuery', () => {
  it('asks for one page with no filters by default', () => {
    expect(toActivityQuery({ view: 'all', area: 'any', text: '' })).toEqual({ limit: ACTIVITY_PAGE_SIZE })
  })

  it('passes area, failed status, trimmed text and the paging cursor', () => {
    expect(toActivityQuery({ view: 'failed', area: 'sites', text: '  deploy ' }, 1000)).toEqual({
      limit: ACTIVITY_PAGE_SIZE,
      before: 1000,
      area: 'sites',
      status: 'failed',
      text: 'deploy'
    })
  })

  it('leaves who filters to the client', () => {
    expect(toActivityQuery({ view: 'you', area: 'any', text: '   ' })).toEqual({ limit: ACTIVITY_PAGE_SIZE })
  })
})

describe('matchesView', () => {
  const mine = activityEntry({ who: 'you' })
  const scheduled = activityEntry({ who: 'scheduled' })
  const failed = activityEntry({ who: 'auto', status: 'failed' })

  it.each([
    ['all', [true, true, true]],
    ['you', [true, false, false]],
    ['auto', [false, true, true]],
    ['failed', [false, false, true]]
  ] as const)('%s view', (view, expected) => {
    expect([mine, scheduled, failed].map((entry) => matchesView(entry, view))).toEqual(expected)
  })
})

describe('paging helpers', () => {
  it('merges pages newest first and replaces entries with the same id', () => {
    const current = [activityEntry({ id: 'b', at: 20 }), activityEntry({ id: 'a', at: 10 })]
    const incoming = [activityEntry({ id: 'c', at: 30 }), activityEntry({ id: 'b', at: 20, status: 'failed' })]
    const merged = mergeEntries(current, incoming)
    expect(merged.map((entry) => entry.id)).toEqual(['c', 'b', 'a'])
    expect(merged[1].status).toBe('failed')
  })

  it('finds the paging cursor at the oldest entry', () => {
    expect(oldestAt([activityEntry({ at: 30 }), activityEntry({ at: 10 })])).toBe(10)
    expect(oldestAt([])).toBeUndefined()
  })

  it('counts failed entries', () => {
    expect(countFailed([activityEntry(), activityEntry({ status: 'failed' }), activityEntry({ status: 'stopped' })])).toBe(1)
  })
})
