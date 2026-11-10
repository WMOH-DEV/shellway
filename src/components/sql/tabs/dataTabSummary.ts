import type { FilterOperator, SortKey, TableFilter } from '@/types/sql'

const OPERATOR_LABELS: Partial<Record<FilterOperator, string>> = {
  equals: '=',
  not_equals: '!=',
  contains: 'contains',
  not_contains: 'not contains',
  starts_with: 'starts with',
  ends_with: 'ends with',
  greater_than: '>',
  less_than: '<',
  greater_or_equal: '>=',
  less_or_equal: '<=',
  in: 'in',
  not_in: 'not in'
}

const SAMPLE_FIELD_COUNT = 4
const MAX_CELL_LENGTH = 40

function describeFilter({ column, operator, value, value2 }: TableFilter): string {
  switch (operator) {
    case 'is_null':
      return `${column} is null`
    case 'is_not_null':
      return `${column} is not null`
    case 'between':
      return `${column} between ${value} and ${value2 ?? ''}`
    case 'raw_sql':
      return value
    default:
      return `${column} ${OPERATOR_LABELS[operator]} ${value}`
  }
}

export function filterSummary(filters: TableFilter[]): string | undefined {
  const parts = filters.filter((f) => f.enabled).map(describeFilter)
  return parts.length > 0 ? parts.join(', ') : undefined
}

export function sortSummary(sortKeys: SortKey[]): string | undefined {
  if (sortKeys.length === 0) return undefined
  return sortKeys.map((k) => `${k.column} ${k.direction === 'desc' ? '↓' : '↑'}`).join(', ')
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH)}…` : text
}

export function sampleRows(rows: Record<string, unknown>[], fieldNames: string[], limit = 3): string[] {
  const names = fieldNames.slice(0, SAMPLE_FIELD_COUNT)
  return rows.slice(0, limit).map((row) => names.map((name) => formatCell(row[name])).join(' · '))
}
