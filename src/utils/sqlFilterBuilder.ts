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

export function buildWhereClause(
  filters: TableFilter[],
  dbType: DatabaseType
): FilterBuildResult {
  const enabledFilters = filters.filter((f) => f.enabled)

  if (enabledFilters.length === 0) {
    return { where: '', params: [] }
  }

  const clauses: string[] = []
  const params: unknown[] = []
  let paramIndex = 1

  for (const filter of enabledFilters) {
    const col = quoteColumn(filter.column, dbType)

    switch (filter.operator) {
      case 'equals': {
        clauses.push(`${col} = ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'not_equals': {
        clauses.push(`${col} != ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'contains': {
        const op = dbType === 'postgres' ? 'ILIKE' : 'LIKE'
        clauses.push(`${col} ${op} ${placeholder(dbType, paramIndex)}`)
        params.push(`%${filter.value}%`)
        paramIndex++
        break
      }
      case 'not_contains': {
        const op = dbType === 'postgres' ? 'NOT ILIKE' : 'NOT LIKE'
        clauses.push(`${col} ${op} ${placeholder(dbType, paramIndex)}`)
        params.push(`%${filter.value}%`)
        paramIndex++
        break
      }
      case 'starts_with': {
        const op = dbType === 'postgres' ? 'ILIKE' : 'LIKE'
        clauses.push(`${col} ${op} ${placeholder(dbType, paramIndex)}`)
        params.push(`${filter.value}%`)
        paramIndex++
        break
      }
      case 'ends_with': {
        const op = dbType === 'postgres' ? 'ILIKE' : 'LIKE'
        clauses.push(`${col} ${op} ${placeholder(dbType, paramIndex)}`)
        params.push(`%${filter.value}`)
        paramIndex++
        break
      }
      case 'greater_than': {
        clauses.push(`${col} > ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'less_than': {
        clauses.push(`${col} < ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'greater_or_equal': {
        clauses.push(`${col} >= ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'less_or_equal': {
        clauses.push(`${col} <= ${placeholder(dbType, paramIndex)}`)
        params.push(filter.value)
        paramIndex++
        break
      }
      case 'is_null': {
        clauses.push(`${col} IS NULL`)
        break
      }
      case 'is_not_null': {
        clauses.push(`${col} IS NOT NULL`)
        break
      }
      case 'in': {
        const values = filter.value.split(',').map((v) => v.trim())
        if (dbType === 'postgres') {
          clauses.push(`${col} = ANY(${placeholder(dbType, paramIndex)}::text[])`)
          params.push(values)
          paramIndex++
        } else {
          const placeholders = values.map(() => {
            const p = placeholder(dbType, paramIndex)
            paramIndex++
            return p
          })
          clauses.push(`${col} IN (${placeholders.join(', ')})`)
          params.push(...values)
        }
        break
      }
      case 'not_in': {
        const values = filter.value.split(',').map((v) => v.trim())
        if (dbType === 'postgres') {
          clauses.push(`${col} != ALL(${placeholder(dbType, paramIndex)}::text[])`)
          params.push(values)
          paramIndex++
        } else {
          const placeholders = values.map(() => {
            const p = placeholder(dbType, paramIndex)
            paramIndex++
            return p
          })
          clauses.push(`${col} NOT IN (${placeholders.join(', ')})`)
          params.push(...values)
        }
        break
      }
      case 'between': {
        const p1 = placeholder(dbType, paramIndex)
        paramIndex++
        const p2 = placeholder(dbType, paramIndex)
        paramIndex++
        clauses.push(`${col} BETWEEN ${p1} AND ${p2}`)
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
          clauses.push(`(${rawValue})`)
        }
        break
      }
    }
  }

  if (clauses.length === 0) {
    return { where: '', params: [] }
  }

  return {
    where: `WHERE ${clauses.join(' AND ')}`,
    params,
  }
}
