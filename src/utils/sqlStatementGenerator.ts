import type { StagedChange, DatabaseType } from '@/types/sql'
import { SQL_EXPR_PREFIX, resolveSQLExpr } from '@/components/sql/TimestampCellEditor'

// ── Identifier & value quoting ──

function quoteIdentifier(name: string, dbType: DatabaseType): string {
  if (dbType === 'mysql') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}

function escapeString(value: string): string {
  return value.replace(/'/g, "''")
}

function formatValue(value: unknown, dbType: DatabaseType): string {
  if (value === null || value === undefined) return 'NULL'

  // SQL expression sentinels (NOW(), DEFAULT) — emit whitelisted raw expression
  if (typeof value === 'string' && value.startsWith(SQL_EXPR_PREFIX)) {
    return resolveSQLExpr(value)
  }

  if (typeof value === 'boolean') {
    if (dbType === 'mysql') return value ? '1' : '0'
    return value ? 'true' : 'false'
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL'
    return String(value)
  }

  if (typeof value === 'bigint') return String(value)

  if (value instanceof Date) return `'${escapeString(value.toISOString())}'`

  return `'${escapeString(String(value))}'`
}

// mysql2 hands back BIGINT/DECIMAL as strings, so the column type — not typeof — decides quoting.
const NUMERIC_SQL_TYPES = new Set([
  'tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint',
  'int2', 'int4', 'int8', 'serial', 'smallserial', 'bigserial',
  'decimal', 'numeric', 'dec', 'fixed',
  'float', 'double', 'real', 'float4', 'float8',
])

const NUMERIC_LITERAL = /^-?\d+(\.\d+)?$/

function isNumericSQLType(type: string | undefined): boolean {
  if (!type) return false
  const base = type.toLowerCase().trim().split(/[\s(]/)[0]
  return NUMERIC_SQL_TYPES.has(base)
}

function formatRowValue(value: unknown, dbType: DatabaseType, sqlType?: string): string {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return `'${escapeString(JSON.stringify(value))}'`
  }
  if (typeof value === 'string' && isNumericSQLType(sqlType) && NUMERIC_LITERAL.test(value)) {
    return value
  }
  return formatValue(value, dbType)
}

// ── Statement generators ──

export function generateUpdateSQL(change: StagedChange, dbType: DatabaseType): string {
  if (change.type !== 'update' || !change.changes) return ''

  const table = quoteIdentifier(change.table, dbType)

  const setClauses = Object.entries(change.changes)
    .map(([col, { new: newVal }]) => `${quoteIdentifier(col, dbType)} = ${formatValue(newVal, dbType)}`)
    .join(', ')

  if (!change.primaryKey) return ''

  const whereClauses = Object.entries(change.primaryKey)
    .map(([col, val]) => `${quoteIdentifier(col, dbType)} = ${formatValue(val, dbType)}`)
    .join(' AND ')

  return `UPDATE ${table} SET ${setClauses} WHERE ${whereClauses};`
}

export function generateInsertSQL(change: StagedChange, dbType: DatabaseType): string {
  if (change.type !== 'insert' || !change.newRow) return ''

  const table = quoteIdentifier(change.table, dbType)
  const entries = Object.entries(change.newRow).filter(([, v]) => v !== undefined)

  const columns = entries.map(([col]) => quoteIdentifier(col, dbType)).join(', ')
  const values = entries.map(([, val]) => formatValue(val, dbType)).join(', ')

  return `INSERT INTO ${table} (${columns}) VALUES (${values});`
}

/**
 * Build a single multi-row INSERT for the given rows. `qualifiedTable` must
 * already be quoted (it may carry a schema prefix); column names are quoted here.
 */
export function generateMultiRowInsert(
  qualifiedTable: string,
  columns: string[],
  rows: Record<string, unknown>[],
  dbType: DatabaseType,
  columnTypes: Record<string, string> = {},
): string {
  if (columns.length === 0 || rows.length === 0) return ''

  const columnList = columns.map((c) => quoteIdentifier(c, dbType)).join(', ')
  const tuples = rows.map(
    (row) => `(${columns.map((c) => formatRowValue(row[c], dbType, columnTypes[c])).join(', ')})`,
  )

  return `INSERT INTO ${qualifiedTable} (${columnList}) VALUES\n${tuples.join(',\n')};`
}

export function generateDeleteSQL(change: StagedChange, dbType: DatabaseType): string {
  if (change.type !== 'delete' || !change.primaryKey) return ''

  const table = quoteIdentifier(change.table, dbType)

  const whereClauses = Object.entries(change.primaryKey)
    .map(([col, val]) => `${quoteIdentifier(col, dbType)} = ${formatValue(val, dbType)}`)
    .join(' AND ')

  return `DELETE FROM ${table} WHERE ${whereClauses};`
}

export function generateSQL(change: StagedChange, dbType: DatabaseType): string {
  switch (change.type) {
    case 'update':
      return generateUpdateSQL(change, dbType)
    case 'insert':
      return generateInsertSQL(change, dbType)
    case 'delete':
      return generateDeleteSQL(change, dbType)
    default:
      return ''
  }
}

export function generateTransaction(changes: StagedChange[], dbType: DatabaseType): string {
  if (changes.length === 0) return ''

  // Merge UPDATE changes by row — multiple cell edits on the same row should
  // produce a single UPDATE statement with all changed columns in the SET clause.
  const mergedUpdates = new Map<string, StagedChange>()
  const nonUpdates: StagedChange[] = []

  for (const change of changes) {
    if (change.type === 'update' && change.primaryKey && change.changes) {
      const pkKey = JSON.stringify(change.primaryKey)
      const existing = mergedUpdates.get(pkKey)
      if (existing && existing.changes) {
        // Merge changes into existing entry
        mergedUpdates.set(pkKey, {
          ...existing,
          changes: { ...existing.changes, ...change.changes },
        })
      } else {
        mergedUpdates.set(pkKey, { ...change, changes: { ...change.changes } })
      }
    } else {
      nonUpdates.push(change)
    }
  }

  const mergedChanges = [...mergedUpdates.values(), ...nonUpdates]
  const statements = mergedChanges
    .map((c) => generateSQL(c, dbType))
    .filter(Boolean)

  return ['BEGIN;', ...statements, 'COMMIT;'].join('\n')
}
