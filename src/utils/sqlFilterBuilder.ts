import type { TableFilter, DatabaseType, FilterOperator, FilterMatch } from '@/types/sql'

export const NO_VALUE_OPERATORS = new Set<FilterOperator>(['is_null', 'is_not_null'])

function hasCriteria(filter: TableFilter): boolean {
  if (NO_VALUE_OPERATORS.has(filter.operator)) return true
  if (filter.value.trim() === '') return false
  return filter.operator !== 'between' || (filter.value2 ?? '').trim() !== ''
}

export function filtersForApplyAll(filters: TableFilter[]): TableFilter[] {
  return filters.map((f) => (f.enabled && !hasCriteria(f) ? { ...f, enabled: false } : f))
}

export interface FilterBuildResult {
  where: string
  params: unknown[]
}

function quoteColumn(column: string, dbType: DatabaseType): string {
  if (dbType === 'mysql') return `\`${column.replace(/`/g, '``')}\``
  return `"${column.replace(/"/g, '""')}"`
}

function placeholder(dbType: DatabaseType, index: number): string {
  if (dbType === 'mysql') return '?'
  return `$${index}`
}

/**
 * Parse a comma-separated list for `IN` / `NOT IN`, trimming whitespace and
 * dropping empty entries. Returns an empty array when no valid values remain,
 * in which case the caller must skip the filter entirely rather than emitting
 * a `WHERE col IN ('')` that silently matches empty-string rows.
 */
function parseInValues(raw: string): string[] {
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
}

export function buildWhereClause(
  filters: TableFilter[],
  dbType: DatabaseType,
  match: FilterMatch = 'all'
): FilterBuildResult {
  const enabledFilters = filters.filter((f) => f.enabled)

  if (enabledFilters.length === 0) {
    return { where: '', params: [] }
  }

  const built: string[] = []
  const params: unknown[] = []
  let paramIndex = 1

  for (const filter of enabledFilters) {
    const col = quoteColumn(filter.column, dbType)
    const push = (sql: string) => built.push(sql)

    switch (filter.operator) {
      case 'equals': {
        push(`${col} = ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'not_equals': {
        push(`${col} != ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'contains': {
        const op = dbType === 'postgres' ? 'ILIKE' : 'LIKE'
        // Cast to text for PostgreSQL so LIKE works on non-string columns (e.g. int, date)
        const containsCol = dbType === 'postgres' ? `${col}::text` : col
        push(`${containsCol} ${op} ${placeholder(dbType, paramIndex)}`)
        params.push(`%${filter.value}%`)
        paramIndex++
        break
      }
      case 'not_contains': {
        const op = dbType === 'postgres' ? 'NOT ILIKE' : 'NOT LIKE'
        const notContainsCol = dbType === 'postgres' ? `${col}::text` : col
        push(`${notContainsCol} ${op} ${placeholder(dbType, paramIndex)}`)
        params.push(`%${filter.value}%`)
        paramIndex++
        break
      }
      case 'starts_with': {
        const op = dbType === 'postgres' ? 'ILIKE' : 'LIKE'
        const startsCol = dbType === 'postgres' ? `${col}::text` : col
        push(`${startsCol} ${op} ${placeholder(dbType, paramIndex)}`)
        params.push(`${filter.value}%`)
        paramIndex++
        break
      }
      case 'ends_with': {
        const op = dbType === 'postgres' ? 'ILIKE' : 'LIKE'
        const endsCol = dbType === 'postgres' ? `${col}::text` : col
        push(`${endsCol} ${op} ${placeholder(dbType, paramIndex)}`)
        params.push(`%${filter.value}`)
        paramIndex++
        break
      }
      case 'greater_than': {
        push(`${col} > ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'less_than': {
        push(`${col} < ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'greater_or_equal': {
        push(`${col} >= ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'less_or_equal': {
        push(`${col} <= ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'is_null': {
        push(`${col} IS NULL`)
        break
      }
      case 'is_not_null': {
        push(`${col} IS NOT NULL`)
        break
      }
      case 'in': {
        const values = parseInValues(filter.value)
        // No valid values → skip the filter entirely rather than emitting
        // `col IN ('')` which silently matches empty-string rows.
        if (values.length === 0) break
        if (dbType === 'postgres') {
          push(`${col} = ANY(${placeholder(dbType, paramIndex)}::text[])`)
          params.push(values)
          paramIndex++
        } else {
          const placeholders = values.map(() => {
            const p = placeholder(dbType, paramIndex)
            paramIndex++
            return p
          })
          push(`${col} IN (${placeholders.join(', ')})`)
          params.push(...values)
        }
        break
      }
      case 'not_in': {
        const values = parseInValues(filter.value)
        // No valid values → skip entirely (same reasoning as `in`).
        if (values.length === 0) break
        if (dbType === 'postgres') {
          push(`${col} != ALL(${placeholder(dbType, paramIndex)}::text[])`)
          params.push(values)
          paramIndex++
        } else {
          const placeholders = values.map(() => {
            const p = placeholder(dbType, paramIndex)
            paramIndex++
            return p
          })
          push(`${col} NOT IN (${placeholders.join(', ')})`)
          params.push(...values)
        }
        break
      }
      case 'between': {
        const p1 = placeholder(dbType, paramIndex)
        paramIndex++
        const p2 = placeholder(dbType, paramIndex)
        paramIndex++
        push(`${col} BETWEEN ${p1} AND ${p2}`)
        params.push(filter.value)
        params.push(filter.value2 ?? '')
        break
      }
      case 'raw_sql': {
        // Raw SQL appended as-is — validate to prevent destructive operations
        const rawValue = filter.value.trim()
        if (rawValue) {
          // Reject multiple statements and destructive keywords
          if (rawValue.includes(';')) break
          const forbidden = /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|ALTER|GRANT|REVOKE|CREATE|EXEC)\b/i
          if (forbidden.test(rawValue)) break
          push(`(${rawValue})`)
        }
        break
      }
    }
  }

  if (built.length === 0) {
    return { where: '', params: [] }
  }

  const joiner = match === 'any' ? ' OR ' : ' AND '
  return { where: `WHERE ${built.join(joiner)}`, params }
}
