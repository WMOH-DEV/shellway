import type { FilterOperator } from '@/types/sql'

export type TableCommand =
  | { kind: 'filter'; table: string; column: string; operator: FilterOperator; value: string }
  | { kind: 'row'; table: string; value: string }

const NAME = '[^\\s.@:=<>!"\']+'
const FILTER = new RegExp(`^(${NAME})[.@](${NAME})?(.*)$`)
const ROW = new RegExp(`^(${NAME}):(\\S+)$`)

const SYMBOLS: [string, FilterOperator][] = [
  ['!=', 'not_equals'],
  ['<>', 'not_equals'],
  ['==', 'equals'],
  ['>=', 'greater_or_equal'],
  ['<=', 'less_or_equal'],
  ['=', 'equals'],
  ['>', 'greater_than'],
  ['<', 'less_than']
]

const NULL_WORDS: Record<string, FilterOperator> = {
  null: 'is_null',
  'is null': 'is_null',
  '!null': 'is_not_null',
  'not null': 'is_not_null',
  'is not null': 'is_not_null'
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value)
  return quoted ? quoted[2] : value
}

function criteria(rest: string): { operator: FilterOperator; value: string } {
  const text = rest.trim()
  const nullOperator = NULL_WORDS[text.toLowerCase().replace(/\s+/g, ' ')]
  if (nullOperator) return { operator: nullOperator, value: '' }
  const symbol = SYMBOLS.find(([prefix]) => text.startsWith(prefix))
  if (symbol) return { operator: symbol[1], value: unquote(text.slice(symbol[0].length).trim()) }
  return { operator: 'contains', value: unquote(text) }
}

export function parseTableCommand(text: string): TableCommand | null {
  const row = ROW.exec(text)
  if (row) return { kind: 'row', table: row[1], value: row[2] }
  const filter = FILTER.exec(text)
  if (!filter) return null
  const [, table, column = '', rest] = filter
  if (rest !== '' && !/^[\s=<>!]/.test(rest)) return null
  return { kind: 'filter', table, column, ...criteria(rest) }
}
