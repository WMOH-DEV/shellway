import { describe, expect, it } from 'vitest'
import { generateMultiRowInsert } from './sqlStatementGenerator'

const AGE_RATINGS = [
  { id: '1', name: '13+', created_at: '2026-03-26 05:23:35' },
  { id: '2', name: '15+', created_at: '2026-03-26 05:23:35' },
]

describe('generateMultiRowInsert', () => {
  it('emits one statement with a tuple per row', () => {
    expect(
      generateMultiRowInsert('`age_ratings`', ['id', 'name'], AGE_RATINGS, 'mysql'),
    ).toBe(
      'INSERT INTO `age_ratings` (`id`, `name`) VALUES\n' +
        "('1', '13+'),\n" +
        "('2', '15+');",
    )
  })

  it('quotes reserved-word columns', () => {
    const sql = generateMultiRowInsert(
      '`chapter_images`',
      ['id', 'order'],
      [{ id: 1, order: 0 }],
      'mysql',
    )
    expect(sql).toBe('INSERT INTO `chapter_images` (`id`, `order`) VALUES\n(1, 0);')
  })

  it('uses double quotes for postgres identifiers', () => {
    const sql = generateMultiRowInsert('"public"."users"', ['id'], [{ id: 7 }], 'postgres')
    expect(sql).toBe('INSERT INTO "public"."users" ("id") VALUES\n(7);')
  })

  it('emits driver-stringified numerics unquoted when the column type is numeric', () => {
    const sql = generateMultiRowInsert(
      '`t`',
      ['id', 'label'],
      [{ id: '42', label: '42' }],
      'mysql',
      { id: 'bigint unsigned', label: 'varchar(255)' },
    )
    expect(sql).toBe("INSERT INTO `t` (`id`, `label`) VALUES\n(42, '42');")
  })

  it('keeps non-numeric text quoted even on a numeric column', () => {
    const sql = generateMultiRowInsert('`t`', ['id'], [{ id: '1e5' }], 'mysql', {
      id: 'decimal(10,2)',
    })
    expect(sql).toBe("INSERT INTO `t` (`id`) VALUES\n('1e5');")
  })

  it('writes NULL for null and missing values', () => {
    const sql = generateMultiRowInsert(
      '`t`',
      ['a', 'b'],
      [{ a: null }],
      'mysql',
    )
    expect(sql).toBe('INSERT INTO `t` (`a`, `b`) VALUES\n(NULL, NULL);')
  })

  it('escapes single quotes and serialises objects as JSON', () => {
    const sql = generateMultiRowInsert(
      '`t`',
      ['note', 'meta'],
      [{ note: "it's", meta: { a: 1 } }],
      'mysql',
    )
    expect(sql).toBe('INSERT INTO `t` (`note`, `meta`) VALUES\n(\'it\'\'s\', \'{"a":1}\');')
  })

  it('returns an empty string when there is nothing to insert', () => {
    expect(generateMultiRowInsert('`t`', [], [{ a: 1 }], 'mysql')).toBe('')
    expect(generateMultiRowInsert('`t`', ['a'], [], 'mysql')).toBe('')
  })
})
