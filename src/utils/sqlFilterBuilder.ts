import type { TableFilter, DatabaseType } from '@/types/sql'

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

/** One successfully-built SQL fragment paired with the column it filters. */
interface BuiltClause {
  column: string
  sql: string
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
  dbType: DatabaseType
): FilterBuildResult {
  const enabledFilters = filters.filter((f) => f.enabled)

  if (enabledFilters.length === 0) {
    return { where: '', params: [] }
  }

  // Keep (column, sql) pairs together so that filters which get skipped
  // (e.g. a raw_sql with a forbidden keyword, or an `IN` with no valid
  // values) don't desync a parallel clauses[]/enabledFilters[] index map
  // downstream. The grouping step at the bottom reads from built[] directly.
  const built: BuiltClause[] = []
  const params: unknown[] = []
  let paramIndex = 1

  for (const filter of enabledFilters) {
    const col = quoteColumn(filter.column, dbType)
    const push = (sql: string) => built.push({ column: filter.column, sql })

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

  // Group clauses by column — same-column filters are OR'd, different columns
  // are AND'd. This makes "id = 1, id = 2" produce "WHERE (id = 1 OR id = 2)"
  // instead of "WHERE id = 1 AND id = 2". Iteration order of the built[]
  // array is preserved in the Map, which preserves the original filter order
  // across different columns for deterministic SQL output.
  const clausesByColumn = new Map<string, string[]>()
  for (const { column, sql } of built) {
    const existing = clausesByColumn.get(column)
    if (existing) {
      existing.push(sql)
    } else {
      clausesByColumn.set(column, [sql])
    }
  }

  const grouped = [...clausesByColumn.values()].map((group) =>
    group.length === 1 ? group[0] : `(${group.join(' OR ')})`
  )

  return {
    where: `WHERE ${grouped.join(' AND ')}`,
    params,
  }
}
