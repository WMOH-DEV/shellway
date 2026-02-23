import type { QueryResult, DatabaseType, SchemaColumn, SchemaIndex, SchemaForeignKey } from '@/types/sql'

// ── Option interfaces ──

export interface CSVOptions {
  includeHeaders: boolean
  delimiter: ',' | '\t' | ';' | '|'
}

export interface JSONOptions {
  prettyPrint: boolean
}

export interface SQLOptions {
  batchSize: number
  includeCreate: boolean
}

export type InsertMode =
  | 'insert'
  | 'replace'
  | 'insert_ignore'
  | 'upsert'

export interface SQLExportEnhancedOptions extends SQLOptions {
  /** Prepend a DROP TABLE IF EXISTS statement */
  addDropTable?: boolean
  /** Use IF NOT EXISTS in CREATE TABLE */
  addIfNotExists?: boolean
  /** Insert mode variant */
  insertMode?: InsertMode
  /** Schema metadata — required when includeCreate is true */
  schema?: {
    columns: SchemaColumn[]
    indexes: SchemaIndex[]
    foreignKeys: SchemaForeignKey[]
  }
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
  // Date objects (returned by pg driver) → ISO string
  if (value instanceof Date) {
    return "'" + value.toISOString() + "'"
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

/**
 * Generate a DROP TABLE IF EXISTS statement.
 */
export function generateDropTableSQL(table: string, dbType: DatabaseType): string {
  const quoted = quoteIdentifier(table, dbType)
  return `DROP TABLE IF EXISTS ${quoted};`
}

/**
 * Generate a CREATE TABLE statement from column/index/foreign key metadata.
 */
export function generateCreateTableSQL(
  columns: SchemaColumn[],
  indexes: SchemaIndex[],
  foreignKeys: SchemaForeignKey[],
  table: string,
  dbType: DatabaseType,
  ifNotExists: boolean = false
): string {
  const quoted = quoteIdentifier(table, dbType)
  const ifNe = ifNotExists ? ' IF NOT EXISTS' : ''
  const parts: string[] = []

  // Column definitions
  for (const col of columns) {
    let def = `  ${quoteIdentifier(col.name, dbType)} ${col.type}`
    if (!col.nullable) def += ' NOT NULL'
    if (col.defaultValue !== null && col.defaultValue !== undefined) {
      def += ` DEFAULT ${col.defaultValue}`
    }
    if (col.isAutoIncrement) {
      def += dbType === 'mysql' ? ' AUTO_INCREMENT' : '' // PostgreSQL uses SERIAL type
    }
    if (col.comment && dbType === 'mysql') {
      def += ` COMMENT '${col.comment.replace(/'/g, "''")}'`
    }
    parts.push(def)
  }

  // Primary key (from indexes)
  const pk = indexes.find((idx) => idx.isPrimary)
  if (pk) {
    const pkCols = pk.columns.map((c) => quoteIdentifier(c, dbType)).join(', ')
    parts.push(`  PRIMARY KEY (${pkCols})`)
  }

  // Unique indexes (non-primary)
  for (const idx of indexes) {
    if (idx.isPrimary || !idx.isUnique) continue
    const idxCols = idx.columns.map((c) => quoteIdentifier(c, dbType)).join(', ')
    parts.push(`  UNIQUE KEY ${quoteIdentifier(idx.name, dbType)} (${idxCols})`)
  }

  // Non-unique indexes
  for (const idx of indexes) {
    if (idx.isPrimary || idx.isUnique) continue
    const idxCols = idx.columns.map((c) => quoteIdentifier(c, dbType)).join(', ')
    if (dbType === 'mysql') {
      parts.push(`  KEY ${quoteIdentifier(idx.name, dbType)} (${idxCols})`)
    }
    // PostgreSQL indexes are created separately — skip inline
  }

  // Foreign keys
  for (const fk of foreignKeys) {
    const fkCols = fk.columns.map((c) => quoteIdentifier(c, dbType)).join(', ')
    const refCols = fk.referencedColumns.map((c) => quoteIdentifier(c, dbType)).join(', ')
    const refTable = quoteIdentifier(fk.referencedTable, dbType)
    let constraint = `  CONSTRAINT ${quoteIdentifier(fk.name, dbType)} FOREIGN KEY (${fkCols}) REFERENCES ${refTable} (${refCols})`
    if (fk.onDelete && fk.onDelete !== 'RESTRICT') constraint += ` ON DELETE ${fk.onDelete}`
    if (fk.onUpdate && fk.onUpdate !== 'RESTRICT') constraint += ` ON UPDATE ${fk.onUpdate}`
    parts.push(constraint)
  }

  const body = parts.join(',\n')
  let sql = `CREATE TABLE${ifNe} ${quoted} (\n${body}\n)`
  if (dbType === 'mysql') sql += ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
  sql += ';'

  // PostgreSQL: add CREATE INDEX statements for non-unique, non-primary indexes
  if (dbType === 'postgres') {
    for (const idx of indexes) {
      if (idx.isPrimary || idx.isUnique) continue
      const idxCols = idx.columns.map((c) => quoteIdentifier(c, dbType)).join(', ')
      sql += `\n\nCREATE INDEX ${quoteIdentifier(idx.name, dbType)} ON ${quoted} (${idxCols});`
    }
  }

  // PostgreSQL: add column comments
  if (dbType === 'postgres') {
    for (const col of columns) {
      if (col.comment) {
        sql += `\n\nCOMMENT ON COLUMN ${quoted}.${quoteIdentifier(col.name, dbType)} IS '${col.comment.replace(/'/g, "''")}';`
      }
    }
  }

  return sql
}

/** Build the INSERT prefix for a given insert mode */
function buildInsertPrefix(
  quotedTable: string,
  columnNames: string,
  mode: InsertMode,
  dbType: DatabaseType
): string {
  switch (mode) {
    case 'replace':
      if (dbType === 'mysql') return `REPLACE INTO ${quotedTable} (${columnNames})`
      // PostgreSQL: use INSERT (suffix adds ON CONFLICT DO UPDATE)
      return `INSERT INTO ${quotedTable} (${columnNames})`
    case 'insert_ignore':
      if (dbType === 'mysql') return `INSERT IGNORE INTO ${quotedTable} (${columnNames})`
      return `INSERT INTO ${quotedTable} (${columnNames})`
    case 'upsert':
    case 'insert':
    default:
      return `INSERT INTO ${quotedTable} (${columnNames})`
  }
}

/**
 * Build a PostgreSQL ON CONFLICT DO UPDATE SET clause from field names.
 * Uses EXCLUDED pseudo-table to reference the incoming row values.
 */
function buildPgConflictUpdateSet(fields: { name: string }[], dbType: DatabaseType): string {
  const setClauses = fields
    .map((f) => {
      const q = quoteIdentifier(f.name, dbType)
      return `${q} = EXCLUDED.${q}`
    })
    .join(', ')
  // Without knowing the specific conflict target, use a generic ON CONFLICT clause.
  // Callers with PK knowledge should supply conflict columns; this is a safe default.
  return ` ON CONFLICT DO UPDATE SET ${setClauses}`
}

/** Build the INSERT suffix for upsert/replace modes */
function buildInsertSuffix(
  mode: InsertMode,
  fields: { name: string }[],
  dbType: DatabaseType
): string {
  if (mode === 'upsert') {
    if (dbType === 'mysql') {
      const updates = fields
        .map((f) => {
          const q = quoteIdentifier(f.name, dbType)
          return `${q}=VALUES(${q})`
        })
        .join(', ')
      return ` ON DUPLICATE KEY UPDATE ${updates}`
    }
    // PostgreSQL: ON CONFLICT DO NOTHING (safe default — full upsert requires knowing the conflict target)
    return ' ON CONFLICT DO NOTHING'
  }
  if (mode === 'replace') {
    if (dbType === 'postgres') {
      // PostgreSQL doesn't have REPLACE — emulate with INSERT ... ON CONFLICT DO UPDATE SET
      return buildPgConflictUpdateSet(fields, dbType)
    }
    // MySQL uses REPLACE INTO prefix — no suffix needed
    return ''
  }
  if (mode === 'insert_ignore' && dbType === 'postgres') {
    return ' ON CONFLICT DO NOTHING'
  }
  return ''
}

export function exportToSQL(
  result: QueryResult,
  table: string,
  dbType: DatabaseType,
  options: SQLOptions | SQLExportEnhancedOptions = { batchSize: 1, includeCreate: false }
): string {
  const { batchSize } = options
  const enhanced = options as SQLExportEnhancedOptions
  const insertMode: InsertMode = enhanced.insertMode ?? 'insert'
  const lines: string[] = []

  const quotedTable = quoteIdentifier(table, dbType)
  const columnNames = result.fields.map((f) => quoteIdentifier(f.name, dbType)).join(', ')

  // Prepend DROP TABLE if requested
  if (enhanced.addDropTable) {
    lines.push(generateDropTableSQL(table, dbType))
    lines.push('')
  }

  // Prepend CREATE TABLE if requested and schema metadata is available
  if (options.includeCreate && enhanced.schema) {
    const createSQL = generateCreateTableSQL(
      enhanced.schema.columns,
      enhanced.schema.indexes,
      enhanced.schema.foreignKeys,
      table,
      dbType,
      enhanced.addIfNotExists ?? false
    )
    lines.push(createSQL)
    lines.push('')
  }

  const prefix = buildInsertPrefix(quotedTable, columnNames, insertMode, dbType)
  const suffix = buildInsertSuffix(insertMode, result.fields, dbType)

  if (batchSize > 1) {
    // Batch INSERT — multiple rows per statement
    for (let i = 0; i < result.rows.length; i += batchSize) {
      const batch = result.rows.slice(i, i + batchSize)
      const valueGroups = batch.map((row) => {
        const values = result.fields.map((f) => escapeSQLValue(row[f.name], dbType))
        return '  (' + values.join(', ') + ')'
      })
      lines.push(`${prefix}\nVALUES\n${valueGroups.join(',\n')}${suffix};`)
    }
  } else {
    // One INSERT per row
    for (const row of result.rows) {
      const values = result.fields.map((f) => escapeSQLValue(row[f.name], dbType))
      lines.push(`${prefix} VALUES (${values.join(', ')})${suffix};`)
    }
  }

  return lines.join('\n\n') + '\n'
}
