import { describe, expect, it } from 'vitest'
import { buildWhereClause } from './sqlFilterBuilder'
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
