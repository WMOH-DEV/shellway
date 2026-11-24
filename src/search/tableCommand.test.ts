import { describe, expect, it } from 'vitest'
import { parseTableCommand } from './tableCommand'

describe('parseTableCommand', () => {
  it.each(['books.title', 'books@title'])('reads %s as a column to filter, with no value yet', (text) => {
    expect(parseTableCommand(text)).toEqual({ kind: 'filter', table: 'books', column: 'title', operator: 'contains', value: '' })
  })

  it('takes everything after the column as a contains value', () => {
    expect(parseTableCommand('books.title red fox')).toMatchObject({ column: 'title', operator: 'contains', value: 'red fox' })
  })

  it.each([
    ['books.id=42', 'equals', '42'],
    ['books.id = 42', 'equals', '42'],
    ['books.status!=draft', 'not_equals', 'draft'],
    ['books.status<>draft', 'not_equals', 'draft'],
    ['books.id==5', 'equals', '5'],
    ['books.id>100', 'greater_than', '100'],
    ['books.id>=100', 'greater_or_equal', '100'],
    ['books.id<5', 'less_than', '5'],
    ['books.id<=5', 'less_or_equal', '5'],
    ['users.email=a@b.com', 'equals', 'a@b.com']
  ])('reads %s', (text, operator, value) => {
    expect(parseTableCommand(text)).toMatchObject({ kind: 'filter', operator, value })
  })

  it.each([
    ['books.deleted_at null', 'is_null'],
    ['books.deleted_at is null', 'is_null'],
    ['books.deleted_at !null', 'is_not_null'],
    ['books.deleted_at not  null', 'is_not_null'],
    ['books.deleted_at IS NOT NULL', 'is_not_null']
  ])('reads %s as a null check', (text, operator) => {
    expect(parseTableCommand(text)).toMatchObject({ column: 'deleted_at', operator, value: '' })
  })

  it('drops quotes around a value', () => {
    expect(parseTableCommand('books.title "red fox"')).toMatchObject({ value: 'red fox' })
    expect(parseTableCommand("books.title='x'")).toMatchObject({ operator: 'equals', value: 'x' })
  })

  it('keeps an operator with no value so the value box can be focused', () => {
    expect(parseTableCommand('books.id>')).toMatchObject({ operator: 'greater_than', value: '' })
  })

  it('reads a table with a dot but no column yet', () => {
    expect(parseTableCommand('books.')).toMatchObject({ table: 'books', column: '', value: '' })
  })

  it('reads table:value as a row lookup', () => {
    expect(parseTableCommand('books:42')).toEqual({ kind: 'row', table: 'books', value: '42' })
  })

  it.each(['books', 'red fox', '', 'books.title.extra', 'books:', ':42'])('ignores %j', (text) => {
    expect(parseTableCommand(text)).toBeNull()
  })
})
