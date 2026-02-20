import type { QueryResult, DatabaseType } from '@/types/sql'

// ── Option interfaces ──

export interface CSVOptions {
  includeHeaders: boolean
  delimiter: ',' | '\t' | ';'
}

export interface JSONOptions {
  prettyPrint: boolean
}

export interface SQLOptions {
  batchSize: number
  includeCreate: boolean
}

// ── CSV Export (RFC 4180) ──

function escapeCSVField(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  // Must quote if contains delimiter, double-quote, or newline
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

export function exportToCSV(
  result: QueryResult,
  options: CSVOptions = { includeHeaders: true, delimiter: ',' }
): string {
  const { includeHeaders, delimiter } = options
  const lines: string[] = []

  // UTF-8 BOM for Excel compatibility
  const bom = '\uFEFF'

  if (includeHeaders) {
    lines.push(result.fields.map((f) => escapeCSVField(f.name, delimiter)).join(delimiter))
  }

  for (const row of result.rows) {
    const values = result.fields.map((f) => escapeCSVField(row[f.name], delimiter))
    lines.push(values.join(delimiter))
  }

  return bom + lines.join('\r\n') + '\r\n'
}

// ── JSON Export ──

export function exportToJSON(
  result: QueryResult,
  options: JSONOptions = { prettyPrint: true }
): string {
  const objects = result.rows.map((row) => {
    const obj: Record<string, unknown> = {}
    for (const field of result.fields) {
      obj[field.name] = row[field.name] ?? null
    }
    return obj
  })

  return options.prettyPrint ? JSON.stringify(objects, null, 2) : JSON.stringify(objects)
}

// ── SQL Export ──

function escapeSQLValue(value: unknown, dbType: DatabaseType): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') {
    return dbType === 'postgres' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
  }
  // String — escape single quotes
  const str = String(value).replace(/'/g, "''")
  // Escape backslashes for MySQL
  if (dbType === 'mysql') {
    return "'" + str.replace(/\\/g, '\\\\') + "'"
  }
  return "'" + str + "'"
}

function quoteIdentifier(name: string, dbType: DatabaseType): string {
  if (dbType === 'mysql') return '`' + name.replace(/`/g, '``') + '`'
  return '"' + name.replace(/"/g, '""') + '"'
}

export function exportToSQL(
  result: QueryResult,
  table: string,
  dbType: DatabaseType,
  options: SQLOptions = { batchSize: 1, includeCreate: false }
): string {
  const { batchSize } = options
  const lines: string[] = []

  const quotedTable = quoteIdentifier(table, dbType)
  const columnNames = result.fields.map((f) => quoteIdentifier(f.name, dbType)).join(', ')

  if (batchSize > 1) {
    // Batch INSERT — multiple rows per statement
    for (let i = 0; i < result.rows.length; i += batchSize) {
      const batch = result.rows.slice(i, i + batchSize)
      const valueGroups = batch.map((row) => {
        const values = result.fields.map((f) => escapeSQLValue(row[f.name], dbType))
        return '  (' + values.join(', ') + ')'
      })
      lines.push(`INSERT INTO ${quotedTable} (${columnNames})\nVALUES\n${valueGroups.join(',\n')};`)
    }
  } else {
    // One INSERT per row
    for (const row of result.rows) {
      const values = result.fields.map((f) => escapeSQLValue(row[f.name], dbType))
      lines.push(`INSERT INTO ${quotedTable} (${columnNames}) VALUES (${values.join(', ')});`)
    }
  }

  return lines.join('\n\n') + '\n'
}
