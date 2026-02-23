// electron/services/SQLDataTransferService.ts

import { EventEmitter } from 'events'
import { createReadStream, createWriteStream } from 'fs'
import { stat } from 'fs/promises'
import { randomUUID } from 'crypto'
import type { Client as SSHClient } from 'ssh2'
import { SQLService, DatabaseType } from './SQLService'
import { splitSQLStatements, scanDangerousStatements, countStatements } from '../utils/sqlParser'
import { parseCSVStream, previewCSV as csvPreview } from '../utils/csvParser'
import { shellEscape, validateIdentifier, quoteIdentifier, validateBinaryPath } from '../utils/shellEscape'

// ── Types ──

export interface TransferProgress {
  operationId: string
  sqlSessionId: string
  operation: 'export' | 'import' | 'backup' | 'restore'
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
  percentage: number // 0-100, -1 for indeterminate
  processedRows?: number
  totalRows?: number
  processedBytes?: number
  totalBytes?: number
  currentTable?: string
  message?: string
  error?: string
  startedAt: number
  completedAt?: number
}

export type ExportFormat = 'sql' | 'csv' | 'json'

export interface ExportOptions {
  format: ExportFormat
  includeStructure: boolean
  includeData: boolean
  tables?: string[]
  /** For SQL format: number of rows per INSERT statement */
  batchSize?: number
  /** For CSV format: delimiter character */
  delimiter?: ',' | '\t' | ';' | '|'
  /** For CSV format: include headers row */
  includeHeaders?: boolean
  /** For JSON format: pretty-print */
  prettyPrint?: boolean
  /** Add DROP TABLE IF EXISTS before CREATE TABLE */
  addDropTable?: boolean
  /** Add IF NOT EXISTS to CREATE TABLE */
  addIfNotExists?: boolean
  /** Schema name (PostgreSQL) */
  schema?: string
}

export interface ImportSQLOptions {
  useTransaction: boolean
  onError: 'abort' | 'skip'
}

export interface ImportCSVOptions {
  table: string
  delimiter: ',' | '\t' | ';' | '|'
  hasHeaders: boolean
  /** Column mapping: CSV column index → DB column name */
  columnMapping?: Record<number, string>
  /** Create table if it doesn't exist */
  createTable?: boolean
  /** Truncate table before import */
  truncateBefore?: boolean
  /** Number of rows per batch INSERT */
  batchSize?: number
  /** Error handling strategy */
  onError: 'abort' | 'skip'
  /** Schema name (PostgreSQL) */
  schema?: string
  /** Total expected rows (from preview) for accurate progress */
  totalRows?: number
}

export interface BackupOptions {
  /** Include structure (--no-data to exclude) */
  includeStructure?: boolean
  /** Include data (--no-create-info to exclude in MySQL) */
  includeData?: boolean
  /** Specific tables (empty = all) */
  tables?: string[]
  /** Additional CLI flags */
  extraArgs?: string[]
}

export interface RestoreOptions {
  /** Additional CLI flags */
  extraArgs?: string[]
}

// ── Security: allowed backup/restore CLI flags ──

const ALLOWED_MYSQL_DUMP_FLAGS = new Set([
  '--single-transaction', '--add-drop-table', '--extended-insert',
  '--routines', '--events', '--triggers', '--no-create-info', '--no-data',
  '--add-drop-database', '--add-locks', '--complete-insert',
  '--create-options', '--quick', '--set-charset',
])

const ALLOWED_PG_DUMP_FLAGS = new Set([
  '--no-owner', '--no-privileges', '--inserts',
  '--data-only', '--schema-only', '--clean', '--if-exists',
  '--no-comments', '--no-tablespaces', '--no-security-labels',
])

const ALLOWED_MYSQL_FLAGS = new Set([
  '--force', '--quick',
])

const ALLOWED_PSQL_FLAGS = new Set([
  '--single-transaction', '--quiet',
])

function validateExtraArgs(args: string[], allowedFlags: Set<string>): string[] {
  const validated: string[] = []
  for (const arg of args) {
    // Only allow exact matches against the whitelist — no value flags
    if (!allowedFlags.has(arg)) {
      throw new Error(`Disallowed CLI flag: ${arg}`)
    }
    validated.push(arg)
  }
  return validated
}

// ── Helpers ──

/** Escape a SQL value for embedding in INSERT statements. */
function escapeSQLValue(value: unknown, dbType: DatabaseType): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') {
    return dbType === 'postgres' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0'
  }
  if (typeof value === 'bigint') return String(value)
  // Date objects (returned by pg driver) → ISO string
  if (value instanceof Date) {
    return "'" + value.toISOString() + "'"
  }
  // Buffer / binary → hex literal
  if (Buffer.isBuffer(value)) {
    return dbType === 'mysql'
      ? `X'${value.toString('hex')}'`
      : `'\\x${value.toString('hex')}'`
  }
  const str = String(value).replace(/'/g, "''")
  if (dbType === 'mysql') {
    return "'" + str.replace(/\\/g, '\\\\') + "'"
  }
  return "'" + str + "'"
}

/** Escape a CSV field per RFC 4180. */
function escapeCSVField(value: unknown, delimiter: string): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

// ── Service ──

export class SQLDataTransferService extends EventEmitter {
  private sqlService: SQLService
  private operations = new Map<string, { controller: AbortController; progress: TransferProgress }>()

  constructor(sqlService: SQLService) {
    super()
    this.sqlService = sqlService
  }

  // ── Internal Helpers ──

  private createOperation(
    sqlSessionId: string,
    operation: TransferProgress['operation']
  ): { operationId: string; controller: AbortController } {
    // Check for existing active operation on this session
    for (const [, op] of this.operations) {
      if (op.progress.sqlSessionId === sqlSessionId && op.progress.status === 'running') {
        throw new Error('An operation is already in progress for this connection')
      }
    }
    const operationId = randomUUID()
    const controller = new AbortController()
    const progress: TransferProgress = {
      operationId,
      sqlSessionId,
      operation,
      status: 'running',
      percentage: 0,
      startedAt: Date.now(),
    }
    this.operations.set(operationId, { controller, progress })
    return { operationId, controller }
  }

  private updateProgress(operationId: string, updates: Partial<TransferProgress>): void {
    const op = this.operations.get(operationId)
    if (!op) return
    Object.assign(op.progress, updates)
    this.emit('progress', op.progress.sqlSessionId, { ...op.progress })
  }

  private completeOperation(
    operationId: string,
    status: 'completed' | 'failed' | 'cancelled',
    error?: string
  ): void {
    const op = this.operations.get(operationId)
    if (!op) return
    op.progress.status = status
    op.progress.completedAt = Date.now()
    if (error) op.progress.error = error
    if (status === 'completed') op.progress.percentage = 100
    this.emit('progress', op.progress.sqlSessionId, { ...op.progress })
    // Clean up after a delay (let UI show completion)
    setTimeout(() => this.operations.delete(operationId), 30000)
  }

  private checkCancelled(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw new Error('Operation cancelled')
    }
  }

  // ── Export ──

  async exportTable(
    sqlSessionId: string,
    table: string,
    filePath: string,
    options: ExportOptions
  ): Promise<{ operationId: string; rowCount: number }> {
    const { operationId, controller } = this.createOperation(sqlSessionId, 'export')
    let rowCount = 0

    try {
      const dbType = this.sqlService.getConnectionType(sqlSessionId)
      if (!dbType) throw new Error('Not connected')

      const schema = options.schema || (dbType === 'postgres' ? 'public' : undefined)
      const quotedTable = quoteIdentifier(table, dbType)

      // Get estimated row count for progress tracking
      const estimatedRows = await this.sqlService.getTableRowCount(sqlSessionId, table, schema)
      this.updateProgress(operationId, {
        totalRows: estimatedRows,
        currentTable: table,
        message: `Exporting ${table}...`,
      })

      const ws = createWriteStream(filePath, { encoding: 'utf-8' })
      try {
        if (options.format === 'json') {
          rowCount = await this.exportTableJSON(
            sqlSessionId, table, dbType, schema, ws, options, estimatedRows, operationId, controller
          )
        } else if (options.format === 'csv') {
          rowCount = await this.exportTableCSV(
            sqlSessionId, table, dbType, schema, ws, options, estimatedRows, operationId, controller
          )
        } else {
          // SQL format
          rowCount = await this.exportTableSQL(
            sqlSessionId, table, dbType, schema, ws, options, estimatedRows, operationId, controller
          )
        }
      } finally {
        // Ensure the write stream is closed — register error handler first
        await new Promise<void>((resolve, reject) => {
          ws.on('error', reject)
          ws.end(() => resolve())
        })
      }

      this.completeOperation(operationId, 'completed')
      return { operationId, rowCount }
    } catch (err: any) {
      const status = controller.signal.aborted ? 'cancelled' : 'failed'
      this.completeOperation(operationId, status, err.message)
      if (status === 'failed') throw err
      return { operationId, rowCount }
    }
  }

  private async exportTableSQL(
    sqlSessionId: string,
    table: string,
    dbType: DatabaseType,
    schema: string | undefined,
    ws: NodeJS.WritableStream,
    options: ExportOptions,
    estimatedRows: number,
    operationId: string,
    controller: AbortController
  ): Promise<number> {
    const quotedTable = quoteIdentifier(table, dbType)
    const batchSize = options.batchSize ?? 100
    let rowCount = 0

    // Structure
    if (options.includeStructure) {
      if (options.addDropTable) {
        ws.write(`DROP TABLE IF EXISTS ${quotedTable};\n\n`)
      }
      let ddl = await this.generateCreateTable(sqlSessionId, table, schema)
      if (options.addIfNotExists && ddl) {
        // Inject IF NOT EXISTS into CREATE TABLE statement
        ddl = ddl.replace(/CREATE TABLE\b/i, 'CREATE TABLE IF NOT EXISTS')
      }
      ws.write(ddl + ';\n\n')
    }

    // Data
    if (options.includeData) {
      this.checkCancelled(controller)

      // Get columns for INSERT statement
      const columns = await this.sqlService.getColumns(sqlSessionId, table, schema)
      const colNames = columns.map((c) => quoteIdentifier(c.name, dbType)).join(', ')

      const selectQuery = schema && dbType === 'postgres'
        ? `SELECT * FROM ${quoteIdentifier(schema, dbType)}.${quotedTable}`
        : `SELECT * FROM ${quotedTable}`

      const stream = await this.sqlService.streamQuery(sqlSessionId, selectQuery)

      let batch: string[] = []

      for await (const row of stream) {
        this.checkCancelled(controller)
        const record = row as Record<string, unknown>

        const values = columns.map((c) => escapeSQLValue(record[c.name], dbType))
        batch.push(`(${values.join(', ')})`)

        if (batch.length >= batchSize) {
          ws.write(`INSERT INTO ${quotedTable} (${colNames})\nVALUES\n  ${batch.join(',\n  ')};\n\n`)
          rowCount += batch.length
          batch = []
          this.updateProgress(operationId, {
            processedRows: rowCount,
            percentage: estimatedRows > 0 ? Math.min(99, Math.round((rowCount / estimatedRows) * 100)) : -1,
          })
        }
      }

      // Flush remaining batch
      if (batch.length > 0) {
        ws.write(`INSERT INTO ${quotedTable} (${colNames})\nVALUES\n  ${batch.join(',\n  ')};\n\n`)
        rowCount += batch.length
      }
    }

    return rowCount
  }

  private async exportTableCSV(
    sqlSessionId: string,
    table: string,
    dbType: DatabaseType,
    schema: string | undefined,
    ws: NodeJS.WritableStream,
    options: ExportOptions,
    estimatedRows: number,
    operationId: string,
    controller: AbortController
  ): Promise<number> {
    const delimiter = options.delimiter ?? ','
    const includeHeaders = options.includeHeaders ?? true
    const quotedTable = quoteIdentifier(table, dbType)
    let rowCount = 0

    // UTF-8 BOM for Excel compatibility
    ws.write('\uFEFF')

    const columns = await this.sqlService.getColumns(sqlSessionId, table, schema)

    if (includeHeaders) {
      ws.write(columns.map((c) => escapeCSVField(c.name, delimiter)).join(delimiter) + '\r\n')
    }

    const selectQuery = schema && dbType === 'postgres'
      ? `SELECT * FROM ${quoteIdentifier(schema, dbType)}.${quotedTable}`
      : `SELECT * FROM ${quotedTable}`

    const stream = await this.sqlService.streamQuery(sqlSessionId, selectQuery)

    for await (const row of stream) {
      this.checkCancelled(controller)
      const record = row as Record<string, unknown>
      const line = columns.map((c) => escapeCSVField(record[c.name], delimiter)).join(delimiter)
      ws.write(line + '\r\n')
      rowCount++

      if (rowCount % 1000 === 0) {
        this.updateProgress(operationId, {
          processedRows: rowCount,
          percentage: estimatedRows > 0 ? Math.min(99, Math.round((rowCount / estimatedRows) * 100)) : -1,
        })
      }
    }

    return rowCount
  }

  private async exportTableJSON(
    sqlSessionId: string,
    table: string,
    dbType: DatabaseType,
    schema: string | undefined,
    ws: NodeJS.WritableStream,
    options: ExportOptions,
    estimatedRows: number,
    operationId: string,
    controller: AbortController
  ): Promise<number> {
    const pretty = options.prettyPrint ?? true
    const quotedTable = quoteIdentifier(table, dbType)
    let rowCount = 0

    const selectQuery = schema && dbType === 'postgres'
      ? `SELECT * FROM ${quoteIdentifier(schema, dbType)}.${quotedTable}`
      : `SELECT * FROM ${quotedTable}`

    const stream = await this.sqlService.streamQuery(sqlSessionId, selectQuery)

    ws.write('[\n')
    let first = true

    for await (const row of stream) {
      this.checkCancelled(controller)

      if (!first) {
        ws.write(',\n')
      }
      first = false

      const json = pretty ? JSON.stringify(row, null, 2) : JSON.stringify(row)
      ws.write(pretty ? json.split('\n').map((l) => '  ' + l).join('\n') : json)
      rowCount++

      if (rowCount % 1000 === 0) {
        this.updateProgress(operationId, {
          processedRows: rowCount,
          percentage: estimatedRows > 0 ? Math.min(99, Math.round((rowCount / estimatedRows) * 100)) : -1,
        })
      }
    }

    ws.write('\n]\n')
    return rowCount
  }

  async exportDatabase(
    sqlSessionId: string,
    filePath: string,
    options: ExportOptions
  ): Promise<{ operationId: string; tableCount: number; totalRows: number }> {
    const { operationId, controller } = this.createOperation(sqlSessionId, 'export')
    let tableCount = 0
    let totalRows = 0

    try {
      const dbType = this.sqlService.getConnectionType(sqlSessionId)
      if (!dbType) throw new Error('Not connected')

      // Only SQL format supported for full database export
      if (options.format !== 'sql') {
        throw new Error('Full database export only supports SQL format')
      }

      const allTables = await this.sqlService.getTables(sqlSessionId)
      const tables = options.tables
        ? allTables.filter((t) => options.tables!.includes(t.name))
        : allTables.filter((t) => t.type === 'table') // Exclude views by default

      const schema = options.schema || (dbType === 'postgres' ? 'public' : undefined)
      const batchSize = options.batchSize ?? 100

      this.updateProgress(operationId, {
        message: `Exporting ${tables.length} tables...`,
        totalRows: tables.reduce((sum, t) => sum + (t.rowCount ?? 0), 0),
      })

      const ws = createWriteStream(filePath, { encoding: 'utf-8' })
      try {
        // Header
        ws.write(`-- Database export generated by Shellway\n`)
        ws.write(`-- Date: ${new Date().toISOString()}\n`)
        ws.write(`-- Database type: ${dbType}\n\n`)

        if (dbType === 'mysql') {
          ws.write(`SET FOREIGN_KEY_CHECKS=0;\n`)
          ws.write(`SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n\n`)
        }

        for (const tableInfo of tables) {
          this.checkCancelled(controller)
          const table = tableInfo.name
          const quotedTable = quoteIdentifier(table, dbType)

          this.updateProgress(operationId, {
            currentTable: table,
            message: `Exporting ${table}...`,
          })

          // Structure
          if (options.includeStructure) {
            if (options.addDropTable) {
              ws.write(`DROP TABLE IF EXISTS ${quotedTable};\n\n`)
            }
            let ddl = await this.generateCreateTable(sqlSessionId, table, schema)
            if (ddl && options.addIfNotExists) {
              ddl = ddl.replace(/CREATE TABLE\b/i, 'CREATE TABLE IF NOT EXISTS')
            }
            if (ddl) {
              ws.write(ddl + ';\n\n')
            }
          }

          // Data
          if (options.includeData) {
            const columns = await this.sqlService.getColumns(sqlSessionId, table, schema)
            const colNames = columns.map((c) => quoteIdentifier(c.name, dbType)).join(', ')

            const selectQuery = schema && dbType === 'postgres'
              ? `SELECT * FROM ${quoteIdentifier(schema, dbType)}.${quotedTable}`
              : `SELECT * FROM ${quotedTable}`

            const stream = await this.sqlService.streamQuery(sqlSessionId, selectQuery)

            let batch: string[] = []
            let tableRowCount = 0

            for await (const row of stream) {
              this.checkCancelled(controller)
              const record = row as Record<string, unknown>
              const values = columns.map((c) => escapeSQLValue(record[c.name], dbType))
              batch.push(`(${values.join(', ')})`)

              if (batch.length >= batchSize) {
                ws.write(`INSERT INTO ${quotedTable} (${colNames})\nVALUES\n  ${batch.join(',\n  ')};\n\n`)
                tableRowCount += batch.length
                totalRows += batch.length
                batch = []
                this.updateProgress(operationId, {
                  processedRows: totalRows,
                })
              }
            }

            if (batch.length > 0) {
              ws.write(`INSERT INTO ${quotedTable} (${colNames})\nVALUES\n  ${batch.join(',\n  ')};\n\n`)
              tableRowCount += batch.length
              totalRows += batch.length
            }

            ws.write(`\n`)
          }

          tableCount++
        }

        // Footer
        if (dbType === 'mysql') {
          ws.write(`SET FOREIGN_KEY_CHECKS=1;\n`)
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          ws.on('error', reject)
          ws.end(() => resolve())
        })
      }

      this.completeOperation(operationId, 'completed')
      return { operationId, tableCount, totalRows }
    } catch (err: any) {
      const status = controller.signal.aborted ? 'cancelled' : 'failed'
      this.completeOperation(operationId, status, err.message)
      if (status === 'failed') throw err
      return { operationId, tableCount, totalRows }
    }
  }

  // ── Import ──

  async importSQL(
    sqlSessionId: string,
    filePath: string,
    options: ImportSQLOptions
  ): Promise<{ operationId: string }> {
    const { operationId, controller } = this.createOperation(sqlSessionId, 'import')

    // Run the import asynchronously — caller gets the operationId immediately
    this.runSQLImport(sqlSessionId, filePath, options, operationId, controller).catch(() => {
      // Error already handled inside runSQLImport
    })

    return { operationId }
  }

  private async runSQLImport(
    sqlSessionId: string,
    filePath: string,
    options: ImportSQLOptions,
    operationId: string,
    controller: AbortController
  ): Promise<void> {
    try {
      const fileStat = await stat(filePath)
      const fileSize = fileStat.size

      this.updateProgress(operationId, {
        totalBytes: fileSize,
        message: 'Preparing SQL import...',
      })

      const readStream = createReadStream(filePath, { encoding: 'utf-8' })
      let processedBytes = 0
      let statementCount = 0
      let errorCount = 0

      // Track bytes as they're read
      readStream.on('data', (chunk: string | Buffer) => {
        const bytes = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
        processedBytes += bytes
      })

      if (options.useTransaction) {
        await this.sqlService.executeQuery(sqlSessionId, 'BEGIN')
      }

      try {
        for await (const stmt of splitSQLStatements(readStream)) {
          this.checkCancelled(controller)

          // Skip empty statements
          if (!stmt.trim()) continue

          try {
            await this.sqlService.executeQuery(sqlSessionId, stmt)
            statementCount++
          } catch (err: any) {
            errorCount++
            if (options.onError === 'abort') {
              throw new Error(`Statement ${statementCount + 1} failed: ${err.message}`)
            }
            // Skip — report the error via progress event and continue
            this.updateProgress(operationId, {
              processedRows: statementCount,
              error: `Statement ${statementCount + errorCount} failed: ${err.message}`,
            })
          }

          // Update progress periodically
          if (statementCount % 50 === 0) {
            this.updateProgress(operationId, {
              processedBytes,
              processedRows: statementCount,
              percentage: fileSize > 0 ? Math.min(99, Math.round((processedBytes / fileSize) * 100)) : -1,
              message: `Executed ${statementCount} statements${errorCount > 0 ? ` (${errorCount} errors)` : ''}...`,
            })
          }
        }

        if (options.useTransaction) {
          await this.sqlService.executeQuery(sqlSessionId, 'COMMIT')
        }

        this.updateProgress(operationId, {
          processedRows: statementCount,
          processedBytes: fileSize,
          message: `Completed: ${statementCount} statements${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
        })
        this.completeOperation(operationId, 'completed')
      } catch (err: any) {
        if (options.useTransaction) {
          try {
            await this.sqlService.executeQuery(sqlSessionId, 'ROLLBACK')
          } catch { /* ignore rollback errors */ }
        }
        throw err
      }
    } catch (err: any) {
      const status = controller.signal.aborted ? 'cancelled' : 'failed'
      this.completeOperation(operationId, status, err.message)
    }
  }

  async importCSV(
    sqlSessionId: string,
    filePath: string,
    options: ImportCSVOptions
  ): Promise<{ operationId: string }> {
    const { operationId, controller } = this.createOperation(sqlSessionId, 'import')

    // Run asynchronously
    this.runCSVImport(sqlSessionId, filePath, options, operationId, controller).catch(() => {
      // Error already handled inside runCSVImport
    })

    return { operationId }
  }

  private async runCSVImport(
    sqlSessionId: string,
    filePath: string,
    options: ImportCSVOptions,
    operationId: string,
    controller: AbortController
  ): Promise<void> {
    try {
      const dbType = this.sqlService.getConnectionType(sqlSessionId)
      if (!dbType) throw new Error('Not connected')

      const fileStat = await stat(filePath)
      const fileSize = fileStat.size
      const batchSize = options.batchSize ?? 100
      const schema = options.schema || (dbType === 'postgres' ? 'public' : undefined)
      const table = options.table
      const quotedTable = schema && dbType === 'postgres'
        ? `${quoteIdentifier(schema, dbType)}.${quoteIdentifier(table, dbType)}`
        : quoteIdentifier(table, dbType)

      const estimatedTotalRows = options.totalRows ?? 0

      this.updateProgress(operationId, {
        totalBytes: fileSize,
        totalRows: estimatedTotalRows > 0 ? estimatedTotalRows : undefined,
        currentTable: table,
        message: 'Preparing CSV import...',
      })

      const readStream = createReadStream(filePath, { encoding: 'utf-8' })
      const csvStream = parseCSVStream(readStream, options.delimiter)

      let headers: string[] = []
      /** Indices of CSV columns to include (after mapping). null = include all. */
      let includedIndices: number[] | null = null
      let isFirstRow = true
      let rowBatch: string[][] = []
      let processedRows = 0
      let errorCount = 0

      // Read header row first if present
      for await (const row of csvStream) {
        this.checkCancelled(controller)

        if (isFirstRow) {
          isFirstRow = false
          if (options.hasHeaders) {
            headers = row
            // Apply column mapping if provided — skip unmapped columns
            if (options.columnMapping) {
              const mappedHeaders: string[] = []
              const indices: number[] = []
              for (let i = 0; i < headers.length; i++) {
                if (options.columnMapping[i] !== undefined) {
                  mappedHeaders.push(options.columnMapping[i])
                  indices.push(i)
                }
                // Columns not in the mapping are skipped
              }
              headers = mappedHeaders
              includedIndices = indices
            }

            // Create table if requested
            if (options.createTable) {
              await this.createTableFromCSV(sqlSessionId, table, headers, dbType, schema)
            }

            // Truncate if requested
            if (options.truncateBefore) {
              await this.sqlService.executeQuery(sqlSessionId, `TRUNCATE TABLE ${quotedTable}`)
            }

            continue
          } else {
            // No headers — generate column names
            headers = row.map((_, i) => `col_${i + 1}`)

            if (options.createTable) {
              await this.createTableFromCSV(sqlSessionId, table, headers, dbType, schema)
            }

            if (options.truncateBefore) {
              await this.sqlService.executeQuery(sqlSessionId, `TRUNCATE TABLE ${quotedTable}`)
            }

            // Don't skip — fall through to process this row as data
          }
        }

        // Filter row data to only include mapped columns
        const filteredRow = includedIndices
          ? includedIndices.map((idx) => (idx < row.length ? row[idx] : ''))
          : row

        rowBatch.push(filteredRow)

        if (rowBatch.length >= batchSize) {
          const errors = await this.insertCSVBatch(
            sqlSessionId, quotedTable, headers, rowBatch, dbType, options.onError
          )
          processedRows += rowBatch.length
          errorCount += errors
          rowBatch = []

          this.updateProgress(operationId, {
            processedRows,
            percentage: estimatedTotalRows > 0
              ? Math.min(99, Math.round((processedRows / estimatedTotalRows) * 100))
              : -1,
            message: `Imported ${processedRows} rows${errorCount > 0 ? ` (${errorCount} errors)` : ''}...`,
          })
        }
      }

      // Flush remaining batch
      if (rowBatch.length > 0) {
        const errors = await this.insertCSVBatch(
          sqlSessionId, quotedTable, headers, rowBatch, dbType, options.onError
        )
        processedRows += rowBatch.length
        errorCount += errors
      }

      this.updateProgress(operationId, {
        processedRows,
        message: `Completed: ${processedRows} rows imported${errorCount > 0 ? `, ${errorCount} errors` : ''}`,
      })
      this.completeOperation(operationId, 'completed')
    } catch (err: any) {
      const status = controller.signal.aborted ? 'cancelled' : 'failed'
      this.completeOperation(operationId, status, err.message)
    }
  }

  /**
   * Insert a batch of CSV rows using PARAMETERIZED queries.
   * NEVER concatenates values into SQL strings.
   * Returns the number of errors encountered.
   */
  private async insertCSVBatch(
    sqlSessionId: string,
    quotedTable: string,
    headers: string[],
    rows: string[][],
    dbType: DatabaseType,
    onError: 'abort' | 'skip'
  ): Promise<number> {
    const colNames = headers.map((h) => quoteIdentifier(h, dbType)).join(', ')
    let errorCount = 0

    if (dbType === 'mysql') {
      // MySQL: INSERT INTO `table` (`col1`, `col2`) VALUES (?, ?), (?, ?)
      const placeholderRow = `(${headers.map(() => '?').join(', ')})`
      const allPlaceholders = rows.map(() => placeholderRow).join(', ')
      const sql = `INSERT INTO ${quotedTable} (${colNames}) VALUES ${allPlaceholders}`

      // Flatten all row values into a single params array
      const params: unknown[] = []
      for (const row of rows) {
        for (let i = 0; i < headers.length; i++) {
          const val = i < row.length ? row[i] : null
          params.push(val === '' ? null : val)
        }
      }

      try {
        await this.sqlService.executeQuery(sqlSessionId, sql, params)
      } catch (err: any) {
        if (onError === 'abort') throw err
        // On skip: try inserting one-by-one to salvage good rows
        errorCount = await this.insertRowsIndividually(
          sqlSessionId, quotedTable, headers, rows, dbType
        )
      }
    } else {
      // PostgreSQL: INSERT INTO "table" ("col1", "col2") VALUES ($1, $2), ($3, $4)
      let paramIdx = 1
      const placeholders: string[] = []
      const params: unknown[] = []

      for (const row of rows) {
        const rowPlaceholders: string[] = []
        for (let i = 0; i < headers.length; i++) {
          rowPlaceholders.push(`$${paramIdx}`)
          paramIdx++
          const val = i < row.length ? row[i] : null
          params.push(val === '' ? null : val)
        }
        placeholders.push(`(${rowPlaceholders.join(', ')})`)
      }

      const sql = `INSERT INTO ${quotedTable} (${colNames}) VALUES ${placeholders.join(', ')}`

      try {
        await this.sqlService.executeQuery(sqlSessionId, sql, params)
      } catch (err: any) {
        if (onError === 'abort') throw err
        errorCount = await this.insertRowsIndividually(
          sqlSessionId, quotedTable, headers, rows, dbType
        )
      }
    }

    return errorCount
  }

  /**
   * Fallback: insert rows one-by-one when a batch fails and onError is 'skip'.
   * Returns the number of rows that failed.
   */
  private async insertRowsIndividually(
    sqlSessionId: string,
    quotedTable: string,
    headers: string[],
    rows: string[][],
    dbType: DatabaseType
  ): Promise<number> {
    const colNames = headers.map((h) => quoteIdentifier(h, dbType)).join(', ')
    let errorCount = 0

    for (const row of rows) {
      const params: unknown[] = []
      let placeholders: string

      if (dbType === 'mysql') {
        placeholders = headers.map(() => '?').join(', ')
      } else {
        placeholders = headers.map((_, i) => `$${i + 1}`).join(', ')
      }

      for (let i = 0; i < headers.length; i++) {
        const val = i < row.length ? row[i] : null
        params.push(val === '' ? null : val)
      }

      const sql = `INSERT INTO ${quotedTable} (${colNames}) VALUES (${placeholders})`

      try {
        await this.sqlService.executeQuery(sqlSessionId, sql, params)
      } catch {
        errorCount++
      }
    }

    return errorCount
  }

  /**
   * Create a table from CSV headers with inferred types.
   */
  private async createTableFromCSV(
    sqlSessionId: string,
    table: string,
    headers: string[],
    dbType: DatabaseType,
    schema?: string
  ): Promise<void> {
    // Use conservative types (TEXT/VARCHAR(255)) since we have no sample data yet
    const types = headers.map(() => dbType === 'mysql' ? 'VARCHAR(255)' : 'TEXT')

    const quotedTable = schema && dbType === 'postgres'
      ? `${quoteIdentifier(schema, dbType)}.${quoteIdentifier(table, dbType)}`
      : quoteIdentifier(table, dbType)

    const columns = headers.map((h, i) =>
      `${quoteIdentifier(h, dbType)} ${types[i]}`
    ).join(',\n  ')

    const sql = `CREATE TABLE IF NOT EXISTS ${quotedTable} (\n  ${columns}\n)`
    await this.sqlService.executeQuery(sqlSessionId, sql)
  }

  // ── Preview / Pre-scan ──

  async previewCSV(filePath: string): Promise<{
    headers: string[]
    sampleRows: string[][]
    totalLines: number
    detectedDelimiter: ',' | '\t' | ';' | '|'
    fileSize: number
  }> {
    return csvPreview(filePath)
  }

  async preScanSQL(filePath: string): Promise<{
    statementCount: number
    dangerousStatements: string[]
    fileSize: number
  }> {
    const fileStat = await stat(filePath)
    const fileSize = fileStat.size

    // Count statements (first stream)
    const countStream = createReadStream(filePath, { encoding: 'utf-8' })
    const statementCount = await countStatements(countStream)

    // Scan for dangerous statements (second stream)
    const scanStream = createReadStream(filePath, { encoding: 'utf-8' })
    const dangerousStatements = await scanDangerousStatements(scanStream)

    return { statementCount, dangerousStatements, fileSize }
  }

  // ── DDL Generation ──

  async generateCreateTable(sqlSessionId: string, table: string, schema?: string): Promise<string> {
    const dbType = this.sqlService.getConnectionType(sqlSessionId)
    if (!dbType) throw new Error('Not connected')

    if (dbType === 'mysql') {
      // SHOW CREATE TABLE returns the exact DDL
      const escaped = table.replace(/`/g, '``')
      const result = await this.sqlService.executeQuery(
        sqlSessionId,
        `SHOW CREATE TABLE \`${escaped}\``
      )
      return (result.rows[0] as Record<string, unknown>)?.['Create Table'] as string || ''
    } else {
      // PostgreSQL: build from schema introspection
      const schemaName = schema || 'public'
      const columns = await this.sqlService.getColumns(sqlSessionId, table, schemaName)
      const indexes = await this.sqlService.getIndexes(sqlSessionId, table, schemaName)
      const foreignKeys = await this.sqlService.getForeignKeys(sqlSessionId, table, schemaName)

      const quotedTable = quoteIdentifier(table, 'postgres')
      const parts: string[] = []

      // Column definitions
      for (const col of columns) {
        let def = `  ${quoteIdentifier(col.name, 'postgres')} ${col.type}`
        if (!col.nullable) def += ' NOT NULL'
        if (col.defaultValue !== null && col.defaultValue !== undefined) {
          def += ` DEFAULT ${col.defaultValue}`
        }
        parts.push(def)
      }

      // Primary key
      const pk = indexes.find((idx) => idx.isPrimary)
      if (pk) {
        const pkCols = pk.columns.map((c) => quoteIdentifier(c, 'postgres')).join(', ')
        parts.push(`  PRIMARY KEY (${pkCols})`)
      }

      // Unique constraints (non-primary)
      for (const idx of indexes) {
        if (idx.isPrimary || !idx.isUnique) continue
        const idxCols = idx.columns.map((c) => quoteIdentifier(c, 'postgres')).join(', ')
        parts.push(`  CONSTRAINT ${quoteIdentifier(idx.name, 'postgres')} UNIQUE (${idxCols})`)
      }

      // Foreign keys
      for (const fk of foreignKeys) {
        const fkCols = fk.columns.map((c) => quoteIdentifier(c, 'postgres')).join(', ')
        const refCols = fk.referencedColumns.map((c) => quoteIdentifier(c, 'postgres')).join(', ')
        const refTable = quoteIdentifier(fk.referencedTable, 'postgres')
        let constraint = `  CONSTRAINT ${quoteIdentifier(fk.name, 'postgres')} FOREIGN KEY (${fkCols}) REFERENCES ${refTable} (${refCols})`
        if (fk.onDelete && fk.onDelete !== 'NO ACTION') constraint += ` ON DELETE ${fk.onDelete}`
        if (fk.onUpdate && fk.onUpdate !== 'NO ACTION') constraint += ` ON UPDATE ${fk.onUpdate}`
        parts.push(constraint)
      }

      const body = parts.join(',\n')
      let sql = `CREATE TABLE ${quotedTable} (\n${body}\n)`

      // Add non-unique, non-primary indexes as separate CREATE INDEX statements
      for (const idx of indexes) {
        if (idx.isPrimary || idx.isUnique) continue
        const idxCols = idx.columns.map((c) => quoteIdentifier(c, 'postgres')).join(', ')
        sql += `;\n\nCREATE INDEX ${quoteIdentifier(idx.name, 'postgres')} ON ${quotedTable} (${idxCols})`
      }

      return sql
    }
  }

  // ── Backup/Restore via SSH ──

  async backupViaSSH(
    sshClient: SSHClient,
    database: string,
    dbType: DatabaseType,
    dbConfig: { host: string; port: number; user: string; password: string },
    filePath: string,
    options: BackupOptions
  ): Promise<{ operationId: string }> {
    // Use a synthetic sqlSessionId for backup operations
    const syntheticSessionId = `backup-${randomUUID()}`
    const { operationId, controller } = this.createOperation(syntheticSessionId, 'backup')

    this.runSSHBackup(
      sshClient, database, dbType, dbConfig, filePath, options,
      operationId, controller
    ).catch(() => {
      // Error already handled inside runSSHBackup
    })

    return { operationId }
  }

  private async runSSHBackup(
    sshClient: SSHClient,
    database: string,
    dbType: DatabaseType,
    dbConfig: { host: string; port: number; user: string; password: string },
    filePath: string,
    options: BackupOptions,
    operationId: string,
    controller: AbortController
  ): Promise<void> {
    try {
      this.updateProgress(operationId, {
        message: 'Detecting remote binary...',
        percentage: -1,
      })

      // Step 1: Detect remote binary
      const binaryName = dbType === 'mysql' ? 'mysqldump' : 'pg_dump'
      const binaryPath = await this.detectRemoteBinary(sshClient, binaryName)
      validateBinaryPath(binaryPath)

      this.updateProgress(operationId, {
        message: `Starting backup using ${binaryPath}...`,
      })

      // Step 2: Build command
      let command: string
      if (dbType === 'mysql') {
        // Password via env var (MYSQL_PWD) — never on command line
        const args: string[] = [
          binaryPath,
          '-h', shellEscape(dbConfig.host),
          '-P', shellEscape(String(dbConfig.port)),
          '-u', shellEscape(dbConfig.user),
        ]

        if (options.includeStructure === false) {
          args.push('--no-create-info')
        }
        if (options.includeData === false) {
          args.push('--no-data')
        }
        if (options.tables && options.tables.length > 0) {
          args.push(shellEscape(database))
          for (const t of options.tables) {
            args.push(shellEscape(t))
          }
        } else {
          args.push(shellEscape(database))
        }
        if (options.extraArgs) {
          const safe = validateExtraArgs(options.extraArgs, ALLOWED_MYSQL_DUMP_FLAGS)
          for (const arg of safe) {
            args.push(arg) // No shellEscape needed — known literal flags
          }
        }

        command = `MYSQL_PWD=${shellEscape(dbConfig.password)} ${args.join(' ')}`
      } else {
        // PostgreSQL
        const args: string[] = [
          binaryPath,
          '-h', shellEscape(dbConfig.host),
          '-p', shellEscape(String(dbConfig.port)),
          '-U', shellEscape(dbConfig.user),
        ]

        if (options.includeStructure === false) {
          args.push('--data-only')
        }
        if (options.includeData === false) {
          args.push('--schema-only')
        }
        if (options.tables && options.tables.length > 0) {
          for (const t of options.tables) {
            args.push('-t', shellEscape(t))
          }
        }
        if (options.extraArgs) {
          const safe = validateExtraArgs(options.extraArgs, ALLOWED_PG_DUMP_FLAGS)
          for (const arg of safe) {
            args.push(shellEscape(arg))
          }
        }

        args.push(shellEscape(database))
        command = `PGPASSWORD=${shellEscape(dbConfig.password)} ${args.join(' ')}`
      }

      // Step 3: Execute via SSH
      this.checkCancelled(controller)

      await new Promise<void>((resolve, reject) => {
        sshClient.exec(command, (err, channel) => {
          if (err) {
            reject(new Error(`SSH exec failed: ${err.message}`))
            return
          }

          const ws = createWriteStream(filePath)
          let stderrBuf = ''
          let bytesWritten = 0
          let lastReportedBytes = 0
          const PROGRESS_THRESHOLD = 1024 * 1024 // 1 MB

          // Pipe stdout as raw Buffer to file (CRITICAL: no string conversion for binary data)
          channel.on('data', (data: Buffer) => {
            ws.write(data)
            bytesWritten += data.length

            if (bytesWritten - lastReportedBytes >= PROGRESS_THRESHOLD) {
              lastReportedBytes = bytesWritten
              this.updateProgress(operationId, {
                processedBytes: bytesWritten,
                message: `Downloaded ${Math.round(bytesWritten / 1024 / 1024)} MB...`,
              })
            }
          })

          channel.stderr.on('data', (data: Buffer) => {
            stderrBuf += data.toString('utf-8')
          })

          // Support cancellation
          const onAbort = (): void => {
            channel.destroy()
            ws.destroy()
          }
          controller.signal.addEventListener('abort', onAbort, { once: true })

          channel.on('close', (code: number) => {
            controller.signal.removeEventListener('abort', onAbort)
            ws.end(() => {
              if (code !== 0) {
                reject(new Error(`Backup exited with code ${code}: ${stderrBuf.trim()}`))
              } else {
                this.updateProgress(operationId, {
                  processedBytes: bytesWritten,
                  message: `Backup complete (${Math.round(bytesWritten / 1024)} KB)`,
                })
                resolve()
              }
            })
          })

          channel.on('error', (channelErr: Error) => {
            controller.signal.removeEventListener('abort', onAbort)
            channel.destroy()
            ws.destroy()
            reject(channelErr)
          })
        })
      })

      this.completeOperation(operationId, 'completed')
    } catch (err: any) {
      const status = controller.signal.aborted ? 'cancelled' : 'failed'
      this.completeOperation(operationId, status, err.message)
    }
  }

  async restoreViaSSH(
    sshClient: SSHClient,
    filePath: string,
    database: string,
    dbType: DatabaseType,
    dbConfig: { host: string; port: number; user: string; password: string },
    options: RestoreOptions
  ): Promise<{ operationId: string }> {
    const syntheticSessionId = `restore-${randomUUID()}`
    const { operationId, controller } = this.createOperation(syntheticSessionId, 'restore')

    this.runSSHRestore(
      sshClient, filePath, database, dbType, dbConfig, options,
      operationId, controller
    ).catch(() => {
      // Error already handled inside runSSHRestore
    })

    return { operationId }
  }

  private async runSSHRestore(
    sshClient: SSHClient,
    filePath: string,
    database: string,
    dbType: DatabaseType,
    dbConfig: { host: string; port: number; user: string; password: string },
    options: RestoreOptions,
    operationId: string,
    controller: AbortController
  ): Promise<void> {
    try {
      const fileStat = await stat(filePath)
      const fileSize = fileStat.size

      this.updateProgress(operationId, {
        totalBytes: fileSize,
        message: 'Detecting remote binary...',
        percentage: -1,
      })

      // Detect binary
      const binaryName = dbType === 'mysql' ? 'mysql' : 'psql'
      const binaryPath = await this.detectRemoteBinary(sshClient, binaryName)
      validateBinaryPath(binaryPath)

      this.updateProgress(operationId, {
        message: `Starting restore using ${binaryPath}...`,
      })

      // Build command
      let command: string
      if (dbType === 'mysql') {
        const args: string[] = [
          binaryPath,
          '-h', shellEscape(dbConfig.host),
          '-P', shellEscape(String(dbConfig.port)),
          '-u', shellEscape(dbConfig.user),
          shellEscape(database),
        ]
        if (options.extraArgs) {
          const safe = validateExtraArgs(options.extraArgs, ALLOWED_MYSQL_FLAGS)
          for (const arg of safe) {
            args.push(arg)
          }
        }
        command = `MYSQL_PWD=${shellEscape(dbConfig.password)} ${args.join(' ')}`
      } else {
        const args: string[] = [
          binaryPath,
          '-h', shellEscape(dbConfig.host),
          '-p', shellEscape(String(dbConfig.port)),
          '-U', shellEscape(dbConfig.user),
          shellEscape(database),
        ]
        if (options.extraArgs) {
          const safe = validateExtraArgs(options.extraArgs, ALLOWED_PSQL_FLAGS)
          for (const arg of safe) {
            args.push(shellEscape(arg))
          }
        }
        command = `PGPASSWORD=${shellEscape(dbConfig.password)} ${args.join(' ')}`
      }

      // Execute: pipe local file → stdin of remote command
      this.checkCancelled(controller)

      await new Promise<void>((resolve, reject) => {
        sshClient.exec(command, (err, channel) => {
          if (err) {
            reject(new Error(`SSH exec failed: ${err.message}`))
            return
          }

          const rs = createReadStream(filePath)
          let stderrBuf = ''
          let bytesWritten = 0
          let lastReportedBytes = 0
          const PROGRESS_THRESHOLD = 512 * 1024 // 512 KB

          // Support cancellation
          const onAbort = (): void => {
            rs.destroy()
            channel.destroy()
          }
          controller.signal.addEventListener('abort', onAbort, { once: true })

          rs.on('data', (chunk: Buffer) => {
            bytesWritten += chunk.length
            if (bytesWritten - lastReportedBytes >= PROGRESS_THRESHOLD || bytesWritten === fileSize) {
              lastReportedBytes = bytesWritten
              this.updateProgress(operationId, {
                processedBytes: bytesWritten,
                percentage: fileSize > 0 ? Math.min(99, Math.round((bytesWritten / fileSize) * 100)) : -1,
                message: `Uploading... ${fileSize > 0 ? Math.round((bytesWritten / fileSize) * 100) : 0}%`,
              })
            }
          })

          // Pipe file to remote stdin
          rs.pipe(channel)

          channel.stderr.on('data', (data: Buffer) => {
            stderrBuf += data.toString('utf-8')
          })

          channel.on('close', (code: number) => {
            controller.signal.removeEventListener('abort', onAbort)
            if (code !== 0) {
              reject(new Error(`Restore exited with code ${code}: ${stderrBuf.trim()}`))
            } else {
              resolve()
            }
          })

          channel.on('error', (channelErr: Error) => {
            controller.signal.removeEventListener('abort', onAbort)
            rs.destroy()
            channel.destroy()
            reject(channelErr)
          })
        })
      })

      this.completeOperation(operationId, 'completed')
    } catch (err: any) {
      const status = controller.signal.aborted ? 'cancelled' : 'failed'
      this.completeOperation(operationId, status, err.message)
    }
  }

  /**
   * Detect a binary on the remote host via `which`.
   * Returns the full path or throws if not found.
   */
  private detectRemoteBinary(sshClient: SSHClient, binaryName: string): Promise<string> {
    return new Promise((resolve, reject) => {
      sshClient.exec(`which ${shellEscape(binaryName)}`, (err, channel) => {
        if (err) {
          reject(new Error(`Failed to detect ${binaryName}: ${err.message}`))
          return
        }

        let stdout = ''
        let stderr = ''

        channel.on('data', (data: Buffer) => {
          stdout += data.toString('utf-8')
        })

        channel.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf-8')
        })

        channel.on('close', (code: number) => {
          const path = stdout.trim()
          if (code !== 0 || !path) {
            reject(new Error(
              `"${binaryName}" not found on remote server. ` +
              `Please ensure it is installed and in the PATH.` +
              (stderr.trim() ? ` stderr: ${stderr.trim()}` : '')
            ))
          } else {
            resolve(path)
          }
        })
      })
    })
  }

  // ── Create Database ──

  async createDatabase(
    sqlSessionId: string,
    options: { name: string; charset?: string; collation?: string; encoding?: string; template?: string }
  ): Promise<{ success: boolean; error?: string }> {
    const dbType = this.sqlService.getConnectionType(sqlSessionId)
    if (!dbType) return { success: false, error: 'Not connected' }

    // MANDATORY — server-side validation
    validateIdentifier(options.name, dbType)

    try {
      if (dbType === 'mysql') {
        let sql = `CREATE DATABASE ${quoteIdentifier(options.name, 'mysql')}`
        if (options.charset) {
          // Validate charset: only allow alphanumeric and underscore
          if (!/^[a-zA-Z0-9_]+$/.test(options.charset)) {
            return { success: false, error: 'Invalid character set name' }
          }
          sql += ` CHARACTER SET ${options.charset}`
        }
        if (options.collation) {
          if (!/^[a-zA-Z0-9_]+$/.test(options.collation)) {
            return { success: false, error: 'Invalid collation name' }
          }
          sql += ` COLLATE ${options.collation}`
        }
        await this.sqlService.executeQuery(sqlSessionId, sql)
      } else {
        let sql = `CREATE DATABASE ${quoteIdentifier(options.name, 'postgres')}`
        if (options.encoding) {
          sql += ` ENCODING '${options.encoding.replace(/'/g, "''")}'`
        }
        if (options.template) {
          validateIdentifier(options.template, 'postgres')
          sql += ` TEMPLATE ${quoteIdentifier(options.template, 'postgres')}`
        }
        await this.sqlService.executeQuery(sqlSessionId, sql)
      }
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  // ── Control ──

  cancel(operationId: string): void {
    const op = this.operations.get(operationId)
    if (!op || op.progress.status !== 'running') return
    op.controller.abort()
    this.completeOperation(operationId, 'cancelled')
  }

  getProgress(operationId: string): TransferProgress | null {
    return this.operations.get(operationId)?.progress
      ? { ...this.operations.get(operationId)!.progress }
      : null
  }

  hasActiveOperation(sqlSessionId: string): boolean {
    for (const [, op] of this.operations) {
      if (op.progress.sqlSessionId === sqlSessionId && op.progress.status === 'running') {
        return true
      }
    }
    return false
  }
}
