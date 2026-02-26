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

  const statements = changes
    .map((c) => generateSQL(c, dbType))
    .filter(Boolean)

  return ['BEGIN;', ...statements, 'COMMIT;'].join('\n')
}
