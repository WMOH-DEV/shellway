import { describe, expect, it } from 'vitest'
import { buildWhereClause, filtersForApplyAll } from './sqlFilterBuilder'
import type { TableFilter } from '@/types/sql'

function filter(column: string, value: string, enabled = true): TableFilter {
  return { id: `${column}-${value}`, enabled, column, operator: 'equals', value }
}

describe('buildWhereClause', () => {
  it('ANDs filters on different columns', () => {
    const { where, params } = buildWhereClause(
      [filter('title', 'a'), filter('status', 'open')],
      'mysql'
    )
    expect(where).toBe('WHERE `title` = ? AND `status` = ?')
    expect(params).toEqual(['a', 'open'])
  })

  it('ORs filters on the same column', () => {
    const { where } = buildWhereClause([filter('title', 'a'), filter('title', 'b')], 'mysql')
    expect(where).toBe('WHERE (`title` = ? OR `title` = ?)')
  })

  it('ignores disabled filters', () => {
    const { where, params } = buildWhereClause(
      [filter('title', 'a'), filter('status', 'open', false)],
      'postgres'
    )
    expect(where).toBe('WHERE "title" = $1')
    expect(params).toEqual(['a'])
  })
})

describe('buildWhereClause with match any', () => {
  it('ORs every active filter, across and within columns', () => {
    const { where, params } = buildWhereClause(
      [filter('id', '1'), filter('title', 'naruto'), filter('title', 'bleach'), filter('status', 'x', false)],
      'mysql',
      'any'
    )
    expect(where).toBe('WHERE `id` = ? OR `title` = ? OR `title` = ?')
    expect(params).toEqual(['1', 'naruto', 'bleach'])
  })
})

describe('filtersForApplyAll', () => {
  it('keeps unticked filters off and skips ticked ones with no value', () => {
    const result = filtersForApplyAll([
      filter('title', 'a'),
      filter('status', 'open', false),
      filter('owner', '')
    ])
    expect(result.map((f) => f.enabled)).toEqual([true, false, false])
  })

  it('keeps value-less operators and needs both between bounds', () => {
    const result = filtersForApplyAll([
      { id: 'n', enabled: true, column: 'deleted_at', operator: 'is_null', value: '' },
      { id: 'b', enabled: true, column: 'age', operator: 'between', value: '18', value2: ' ' },
      { id: 'w', enabled: true, column: 'name', operator: 'equals', value: '   ' }
    ])
    expect(result.map((f) => f.enabled)).toEqual([true, false, false])
  })
})
