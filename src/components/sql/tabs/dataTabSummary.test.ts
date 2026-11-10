import { describe, expect, it } from 'vitest'
import type { FilterOperator, SortKey, TableFilter } from '@/types/sql'
import { filterSummary, sampleRows, sortSummary } from './dataTabSummary'

const filter = (operator: FilterOperator, value = '', extra: Partial<TableFilter> = {}): TableFilter => ({
  id: 'f',
  enabled: true,
  column: 'age',
  operator,
  value,
  ...extra
})

describe('filterSummary', () => {
  it('returns undefined without enabled filters', () => {
    expect(filterSummary([])).toBeUndefined()
    expect(filterSummary([filter('equals', '1', { enabled: false })])).toBeUndefined()
  })

  it.each([
    ['equals', '='],
    ['not_equals', '!='],
    ['contains', 'contains'],
    ['not_contains', 'not contains'],
    ['starts_with', 'starts with'],
    ['ends_with', 'ends with'],
    ['greater_than', '>'],
    ['less_than', '<'],
    ['greater_or_equal', '>='],
    ['less_or_equal', '<='],
    ['in', 'in'],
    ['not_in', 'not in']
  ] as const)('formats %s', (operator, symbol) => {
    expect(filterSummary([filter(operator, '5')])).toBe(`age ${symbol} 5`)
  })

  it('formats null checks without a value', () => {
    expect(filterSummary([filter('is_null', 'ignored')])).toBe('age is null')
    expect(filterSummary([filter('is_not_null')])).toBe('age is not null')
  })

  it('formats between with both bounds', () => {
    expect(filterSummary([filter('between', '1', { value2: '9' })])).toBe('age between 1 and 9')
    expect(filterSummary([filter('between', '1')])).toBe('age between 1 and ')
  })

  it('uses raw sql alone', () => {
    expect(filterSummary([filter('raw_sql', 'age > 3 OR id = 1')])).toBe('age > 3 OR id = 1')
  })

  it('joins enabled filters and skips disabled ones', () => {
    const filters = [
      filter('equals', '1'),
      filter('contains', 'x', { enabled: false }),
      filter('is_null', '', { column: 'name' })
    ]
    expect(filterSummary(filters)).toBe('age = 1, name is null')
  })
})

describe('sortSummary', () => {
  it('returns undefined when empty', () => {
    expect(sortSummary([])).toBeUndefined()
  })

  it('uses arrows per direction', () => {
    const keys: SortKey[] = [
      { column: 'name', direction: 'asc' },
      { column: 'age', direction: 'desc' }
    ]
    expect(sortSummary(keys)).toBe('name ↑, age ↓')
  })
})

describe('sampleRows', () => {
  const fields = ['a', 'b', 'c', 'd', 'e']

  it('joins the first four fields of each row', () => {
    expect(sampleRows([{ a: 1, b: 'x', c: true, d: 4, e: 5 }], fields)).toEqual(['1 · x · true · 4'])
  })

  it('limits the number of rows', () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]
    expect(sampleRows(rows, ['a'])).toEqual(['1', '2', '3'])
    expect(sampleRows(rows, ['a'], 2)).toEqual(['1', '2'])
  })

  it('renders null and undefined as NULL', () => {
    expect(sampleRows([{ a: null, b: undefined }], ['a', 'b'])).toEqual(['NULL · NULL'])
  })

  it('stringifies objects', () => {
    expect(sampleRows([{ a: { k: 1 } }], ['a'])).toEqual(['{"k":1}'])
  })

  it('truncates long strings to 40 characters', () => {
    const [row] = sampleRows([{ a: 'x'.repeat(50) }], ['a'])
    expect(row).toBe(`${'x'.repeat(40)}…`)
  })

  it('keeps a 40 character string intact', () => {
    expect(sampleRows([{ a: 'y'.repeat(40) }], ['a'])).toEqual(['y'.repeat(40)])
  })

  it('returns nothing for no rows', () => {
    expect(sampleRows([], fields)).toEqual([])
  })
})
