// electron/services/SQLDataTransferService.ts

import { EventEmitter } from 'events'
import { createReadStream, createWriteStream, type WriteStream } from 'fs'
import { stat, mkdir } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { createGunzip, createUnzip } from 'zlib'
import { app } from 'electron'
import type { Readable } from 'stream'
import type { Client as SSHClient } from 'ssh2'
import { SQLService, DatabaseType } from './SQLService'
import { splitSQLStatements, preScanStatements } from '../utils/sqlParser'
import { parseCSVStream, previewCSV as csvPreview } from '../utils/csvParser'
import { shellEscape, validateIdentifier, quoteIdentifier, validateBinaryPath } from '../utils/shellEscape'
import {
  classifyError,
  getHealOptions,
  pickAutoStrategy,
  isSafeForSmartAuto,
  type ClassifiedError,
} from '../utils/sqlErrorClassifier'
import { applyHeal } from './HealingEngine'
import { writeCheckpoint, deleteCheckpoint } from './TransferCheckpointStore'
import type {
  HealRunMode,
  HealErrorClass,
  HealDecision,
  ResolutionRequest,
  TransferStats,
} from '../../src/types/sql'

// ── Types ──

export interface TransferProgress {
  operationId: string
  sqlSessionId: string
  operation: 'export' | 'import' | 'backup' | 'restore'
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  percentage: number // 0-100, -1 for indeterminate
  processedRows?: number
  totalRows?: number
  processedBytes?: number
  totalBytes?: number
  currentTable?: string
  message?: string
  error?: string
  /** Preview of the currently-executing statement (truncated). */
  currentStatement?: string
  /** Cumulative tally (executed/healed/skipped/quarantined/failed). */
  stats?: TransferStats
  /** Path to the quarantine file (if any statements were quarantined). */
  quarantinePath?: string
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
  /**
   * Healing run mode. Takes precedence over `onError` when set.
   * - 'full-auto': apply recommended heal for every error, never prompt
   * - 'smart': auto-heal safe classes, prompt on risky ones (default in UI)
   * - 'ask-always': prompt on every error
   * - 'strict-abort': stop on first error (equivalent to onError: 'abort')
   */
  runMode?: HealRunMode
  /**
   * Skip the first N statements on resume. Used when restarting an import
   * from a checkpoint after a crash or cancel.
   */
  skipFirst?: number
  /** Database name for checkpoint metadata (shown in resume prompt). */
  database?: string
  /**
   * Dry run: wrap the whole import in a transaction that is always rolled
   * back at the end. Healing decisions still flow through, so the user gets
   * a full report of what would happen without touching the target. Note
   * that MySQL commits DDL implicitly — CREATE/ALTER/DROP TABLE will still
   * persist.
   */
  dryRun?: boolean
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
  /** Healing run mode (same semantics as ImportSQLOptions.runMode). */
  runMode?: HealRunMode
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

/** Shorten a statement for UI preview — keeps the first few tokens. */
function truncateForPreview(stmt: string, max = 120): string {
  const collapsed = stmt.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? collapsed.slice(0, max) + '…' : collapsed
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

  // ── Healing state (per operation) ──
  /** Unblocks the paused import loop when the user (or auto) resolves an error. */
  private pendingResolutions = new Map<string, (decision: HealDecision) => void>()
  /** "Apply to all similar errors" — remembered decisions per error class, per run. */
  private decisionMemory = new Map<string, Map<HealErrorClass, HealDecision>>()
  /** Running stats for each operation (executed/healed/skipped/quarantined/failed). */
  private operationStats = new Map<string, TransferStats>()
  /** Per-op quarantine file stream; lazily created on first quarantine. */
  private quarantineStreams = new Map<string, { path: string; stream: WriteStream; count: number }>()

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
    const stats: TransferStats = { executed: 0, healed: 0, skipped: 0, quarantined: 0, failed: 0 }
    const progress: TransferProgress = {
      operationId,
      sqlSessionId,
      operation,
      status: 'running',
      percentage: 0,
      stats: { ...stats },
      startedAt: Date.now(),
    }
    this.operations.set(operationId, { controller, progress })
    this.operationStats.set(operationId, stats)
    return { operationId, controller }
  }

  private updateProgress(operationId: string, updates: Partial<TransferProgress>): void {
    const op = this.operations.get(operationId)
    if (!op) return
    // Always ship the current stats snapshot along with updates so UI stays in sync
    const stats = this.operationStats.get(operationId)
    Object.assign(op.progress, updates, stats ? { stats: { ...stats } } : {})
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
    const stats = this.operationStats.get(operationId)
    if (stats) op.progress.stats = { ...stats }
    const qinfo = this.quarantineStreams.get(operationId)
    if (qinfo) op.progress.quarantinePath = qinfo.path
    this.emit('progress', op.progress.sqlSessionId, { ...op.progress })
    // Close quarantine file if any
    void this.closeQuarantine(operationId)
    // Drop any pending resolver (caller aborted/cancelled while paused)
    this.pendingResolutions.delete(operationId)
    this.decisionMemory.delete(operationId)
    // Clean up after a delay (let UI show completion)
    setTimeout(() => {
      this.operations.delete(operationId)
      this.operationStats.delete(operationId)
    }, 30000)
  }

  private checkCancelled(controller: AbortController): void {
    if (controller.signal.aborted) {
      throw new Error('Operation cancelled')
    }
  }

  private bumpStat(operationId: string, key: keyof TransferStats): void {
    const stats = this.operationStats.get(operationId)
    if (stats) stats[key] += 1
  }

  // ── Healing: pause/resume protocol ──

  /**
   * Resolve a paused operation with the caller's heal decision. Called from the
   * IPC layer in response to a user's choice in the HealingDialog.
   */
  resolveOperation(
    operationId: string,
    decision: HealDecision,
  ): { success: boolean; error?: string } {
    const resolver = this.pendingResolutions.get(operationId)
    if (!resolver) {
      return { success: false, error: 'No pending resolution for this operation' }
    }
    this.pendingResolutions.delete(operationId)
    resolver(decision)
    return { success: true }
  }

  /** Block the import loop until `resolveOperation` is called (or operation is cancelled). */
  private waitForResolution(
    operationId: string,
    controller: AbortController,
    request: ResolutionRequest,
  ): Promise<HealDecision> {
    return new Promise<HealDecision>((resolve, reject) => {
      this.pendingResolutions.set(operationId, (decision) => {
        controller.signal.removeEventListener('abort', onAbort)
        resolve(decision)
      })
      const onAbort = (): void => {
        this.pendingResolutions.delete(operationId)
        reject(new Error('Operation cancelled'))
      }
      controller.signal.addEventListener('abort', onAbort, { once: true })
      this.updateProgress(operationId, {
        status: 'paused',
        message: `Paused on statement ${request.statementIndex} — awaiting resolution (${request.errorClass})`,
      })
      this.emit('resolution-request', request.sqlSessionId, request)
    })
  }

  /**
   * Central error-resolution flow. Classifies, consults decision memory,
   * applies run-mode policy, optionally prompts the user, then returns what
   * the caller should do next.
   *
   * Returns:
   *   { status: 'skipped' }                    — proceed to next statement
   *   { status: 'retry', statement }           — re-execute `statement`
   *   (throws)                                 — abort the whole operation
   */
  private async handleStatementError(
    operationId: string,
    sqlSessionId: string,
    dbType: DatabaseType,
    statement: string,
    statementIndex: number,
    error: unknown,
    runMode: HealRunMode,
    controller: AbortController,
  ): Promise<{ status: 'skipped' } | { status: 'retry'; statement: string }> {
    const classified: ClassifiedError = classifyError(error, dbType)
    const memory = this.decisionMemory.get(operationId)
    let decision: HealDecision | null = null

    // 1) Remembered "apply to all" for this class?
    const remembered = memory?.get(classified.class)
    if (remembered) decision = remembered

    // 2) Strict mode bypasses heal entirely
    if (!decision && runMode === 'strict-abort') {
      this.bumpStat(operationId, 'failed')
      throw new Error(`Statement ${statementIndex} failed: ${classified.message}`)
    }

    // 3) Auto-decide based on mode
    if (!decision) {
      if (runMode === 'full-auto') {
        const auto = pickAutoStrategy(classified.class, dbType)
        decision = auto ? { action: 'heal', strategy: auto } : { action: 'skip' }
      } else if (runMode === 'smart' && isSafeForSmartAuto(classified.class)) {
        const auto = pickAutoStrategy(classified.class, dbType)
        if (auto) decision = { action: 'heal', strategy: auto }
      }
    }

    // 4) Still undecided → ask the user (ask-always, or smart on a risky class)
    if (!decision) {
      const request: ResolutionRequest = {
        operationId,
        sqlSessionId,
        statementIndex,
        statement,
        errorClass: classified.class,
        errorMessage: classified.message,
        errorCode: classified.code,
        availableStrategies: getHealOptions(classified.class, dbType),
      }
      decision = await this.waitForResolution(operationId, controller, request)
      // Unpause
      this.updateProgress(operationId, { status: 'running' })
    }

    // Persist remember-for-class choice
    if (decision.rememberForClass) {
      if (!memory) this.decisionMemory.set(operationId, new Map([[classified.class, decision]]))
      else memory.set(classified.class, decision)
    }

    // Apply the decision
    if (decision.action === 'abort') {
      this.bumpStat(operationId, 'failed')
      throw new Error(`User aborted at statement ${statementIndex}: ${classified.message}`)
    }
    if (decision.action === 'skip') {
      this.bumpStat(operationId, 'skipped')
      this.updateProgress(operationId, {
        error: `Statement ${statementIndex} skipped (${classified.class}): ${classified.message}`,
      })
      return { status: 'skipped' }
    }
    if (decision.action === 'quarantine') {
      await this.quarantineStatement(operationId, statement, classified, statementIndex)
      this.bumpStat(operationId, 'quarantined')
      return { status: 'skipped' }
    }
    if (decision.action === 'retry') {
      return { status: 'retry', statement: decision.editedStatement ?? statement }
    }

    // action === 'heal'
    const outcome = applyHeal({ dbType, statement, error: classified, decision })
    // Run any pre-statements (session flags, ALTERs, DROP IF EXISTS)
    if (outcome.preStatements) {
      for (const pre of outcome.preStatements) {
        try {
          await this.sqlService.executeQuery(sqlSessionId, pre)
        } catch (preErr: unknown) {
          const msg = preErr instanceof Error ? preErr.message : String(preErr)
          this.bumpStat(operationId, 'skipped')
          this.updateProgress(operationId, {
            error: `Heal pre-statement failed at stmt ${statementIndex}: ${msg}`,
          })
          return { status: 'skipped' }
        }
      }
    }
    if (!outcome.rewritten) {
      // Heal didn't produce a rewrite (e.g. needs schema introspection) — quarantine instead of silently dropping
      await this.quarantineStatement(operationId, statement, classified, statementIndex)
      this.bumpStat(operationId, 'quarantined')
      return { status: 'skipped' }
    }
    return { status: 'retry', statement: outcome.rewritten }
  }

  /**
   * Execute a statement with the healing flow wrapped around it. First-attempt
   * successes bump `executed`; successes after heal bump `healed`.
   * Returns 'executed' or 'skipped'. Throws on abort.
   */
  private async tryExecuteWithHealing(
    operationId: string,
    sqlSessionId: string,
    dbType: DatabaseType,
    statement: string,
    statementIndex: number,
    runMode: HealRunMode,
    controller: AbortController,
    params?: unknown[],
  ): Promise<'executed' | 'skipped'> {
    let currentStmt = statement
    let attempts = 0
    const MAX_ATTEMPTS = 4
    while (true) {
      attempts++
      try {
        // Only first attempt uses original params (heals may rewrite the SQL
        // but we pass params through unchanged — most statement-level heals
        // preserve placeholder positions).
        await this.sqlService.executeQuery(sqlSessionId, currentStmt, params)
        if (attempts === 1) this.bumpStat(operationId, 'executed')
        else this.bumpStat(operationId, 'healed')
        return 'executed'
      } catch (err: unknown) {
        if (attempts >= MAX_ATTEMPTS) {
          const msg = err instanceof Error ? err.message : String(err)
          if (runMode === 'strict-abort') throw err
          this.bumpStat(operationId, 'skipped')
          this.updateProgress(operationId, {
            error: `Statement ${statementIndex} failed after ${attempts} attempts: ${msg}`,
          })
          return 'skipped'
        }
        const result = await this.handleStatementError(
          operationId,
          sqlSessionId,
          dbType,
          currentStmt,
          statementIndex,
          err,
          runMode,
          controller,
        )
        if (result.status === 'skipped') return 'skipped'
        currentStmt = result.statement
      }
    }
  }

  /**
   * Map legacy {onError, useTransaction} options to a HealRunMode. A caller
   * that supplies `runMode` directly takes precedence.
   */
  private resolveRunMode(options: {
    runMode?: HealRunMode
    onError?: 'abort' | 'skip'
  }): HealRunMode {
    if (options.runMode) return options.runMode
    return options.onError === 'skip' ? 'full-auto' : 'strict-abort'
  }

  // ── Healing: quarantine file writer (P2 will add re-import) ──

  private async quarantineStatement(
    operationId: string,
    statement: string,
    classified: ClassifiedError,
    statementIndex: number,
  ): Promise<void> {
    try {
      let info = this.quarantineStreams.get(operationId)
      if (!info) {
        // Resolve userData dir lazily — works in both main process and tests.
        const baseDir = app?.getPath ? join(app.getPath('userData'), 'shellway', 'quarantine') : '.shellway-quarantine'
        await mkdir(baseDir, { recursive: true })
        const fname = `${Date.now()}-${operationId.slice(0, 8)}.sql`
        const path = join(baseDir, fname)
        const stream = createWriteStream(path, { flags: 'w', encoding: 'utf-8' })
        stream.write(`-- Shellway quarantine file\n`)
        stream.write(`-- Operation: ${operationId}\n`)
        stream.write(`-- Created:   ${new Date().toISOString()}\n`)
        stream.write(`-- Each entry: an error annotation followed by the offending statement.\n`)
        stream.write(`-- Re-run this file in Shellway after reviewing/fixing to apply the skipped statements.\n\n`)
        info = { path, stream, count: 0 }
        this.quarantineStreams.set(operationId, info)
        this.updateProgress(operationId, { quarantinePath: path })
      }
      info.count += 1
      info.stream.write(`-- [${info.count}] stmt #${statementIndex} · class=${classified.class}`)
      if (classified.code !== undefined) info.stream.write(` · code=${classified.code}`)
      info.stream.write(`\n-- error: ${classified.message.replace(/\r?\n/g, ' ')}\n`)
      info.stream.write(statement.trim())
      if (!statement.trimEnd().endsWith(';')) info.stream.write(';')
      info.stream.write('\n\n')
    } catch (err: unknown) {
      // If the file system is broken, don't crash the whole import — just
      // report and let this one statement be counted as skipped instead.
      const msg = err instanceof Error ? err.message : String(err)
      this.updateProgress(operationId, { error: `Quarantine write failed: ${msg}` })
    }
  }

  private async closeQuarantine(operationId: string): Promise<void> {
    const info = this.quarantineStreams.get(operationId)
    if (!info) return
    this.quarantineStreams.delete(operationId)
    await new Promise<void>((resolve) => {
      info.stream.end(() => resolve())
    })
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
      const dbType = this.sqlService.getConnectionType(sqlSessionId)
      if (!dbType) throw new Error('Not connected')

      const fileStat = await stat(filePath)
      const fileSize = fileStat.size

      const runMode = this.resolveRunMode(options)
      const dryRun = options.dryRun === true
      // A transaction is only coherent with strict-abort OR a dry run (where
      // we always roll back at the end). Callers that ask for heal + tx in
      // any other combination silently drop the transaction.
      const useTransaction = dryRun || (options.useTransaction && runMode === 'strict-abort')

      // Detect archive format from extension. gzip + zlib-deflate are handled
      // natively; other archive formats (zip, tar, bz2) require external deps
      // we don't ship — reject with a clear message rather than exploding.
      const lower = filePath.toLowerCase()
      const isGzip = /\.gz$/i.test(filePath)
      const isDeflate = /\.(z|zz|deflate)$/i.test(filePath)
      if (/\.zip$/i.test(lower)) {
        throw new Error(
          '.zip archives are not yet supported directly — extract the .sql file first, or use a .sql.gz dump.',
        )
      }
      if (/\.bz2$/i.test(lower)) {
        throw new Error(
          '.bz2 archives are not yet supported directly — extract the .sql file first, or use a .sql.gz dump.',
        )
      }
      if (/\.tar(\.gz)?$/i.test(lower)) {
        throw new Error(
          'tar/tar.gz archives hold multiple files — extract the target .sql (or .sql.gz) and import it directly.',
        )
      }

      this.updateProgress(operationId, {
        totalBytes: fileSize,
        message: isGzip
          ? 'Preparing SQL import (decompressing gzip)...'
          : isDeflate
            ? 'Preparing SQL import (decompressing deflate)...'
            : 'Preparing SQL import...',
      })

      // Track raw file bytes read from disk so the progress bar reflects the
      // user-visible file size — matters for .gz where decompressed bytes are
      // much larger than the on-disk size.
      let processedBytes = 0
      let statementIndex = 0

      const fileStream = createReadStream(filePath)
      fileStream.on('data', (chunk: Buffer | string) => {
        processedBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      })

      let readStream: Readable
      if (isGzip) {
        const gunzip = createGunzip()
        fileStream.pipe(gunzip)
        readStream = gunzip
      } else if (isDeflate) {
        // createUnzip auto-detects gzip + raw deflate + zlib-deflate
        const unzip = createUnzip()
        fileStream.pipe(unzip)
        readStream = unzip
      } else {
        readStream = fileStream
      }
      readStream.setEncoding('utf-8')

      if (useTransaction) {
        await this.sqlService.executeQuery(sqlSessionId, 'BEGIN')
      }

      const skipFirst = options.skipFirst ?? 0
      try {
        for await (const stmt of splitSQLStatements(readStream)) {
          this.checkCancelled(controller)
          if (!stmt.trim()) continue

          statementIndex++

          // Fast-forward past already-executed statements on resume.
          if (statementIndex <= skipFirst) continue

          await this.tryExecuteWithHealing(
            operationId,
            sqlSessionId,
            dbType,
            stmt,
            statementIndex,
            runMode,
            controller,
          )

          // Periodic progress update
          if (statementIndex % 50 === 0) {
            const stats = this.operationStats.get(operationId)
            const errTotal = stats ? stats.skipped + stats.quarantined : 0
            this.updateProgress(operationId, {
              processedBytes,
              processedRows: stats?.executed ?? 0,
              percentage: fileSize > 0 ? Math.min(99, Math.round((processedBytes / fileSize) * 100)) : -1,
              currentStatement: truncateForPreview(stmt),
              message: errTotal > 0
                ? `Executed ${stats?.executed ?? 0}, healed ${stats?.healed ?? 0}, skipped ${stats?.skipped ?? 0}, quarantined ${stats?.quarantined ?? 0}`
                : `Executed ${stats?.executed ?? 0} statements (${stats?.healed ?? 0} healed)`,
            })
          }

          // Checkpoint every 500 stmts so interrupted runs can resume.
          if (statementIndex % 500 === 0 && runMode !== 'strict-abort') {
            void writeCheckpoint({
              operationId,
              filePath,
              label: filePath.split(/[/\\]/).pop() ?? filePath,
              stmtIndex: statementIndex,
              processedBytes,
              totalBytes: fileSize,
              dbType,
              runMode,
              updatedAt: Date.now(),
              database: options.database,
            })
          }

          // Yield to event loop periodically for GC
          if (statementIndex % 200 === 0) {
            await new Promise<void>((resolve) => setImmediate(resolve))
          }
        }

        if (useTransaction) {
          // Dry run always rolls back; strict-abort path commits.
          if (dryRun) {
            try {
              await this.sqlService.executeQuery(sqlSessionId, 'ROLLBACK')
            } catch { /* ignore */ }
          } else {
            await this.sqlService.executeQuery(sqlSessionId, 'COMMIT')
          }
        }

        const finalStats = this.operationStats.get(operationId)
        this.updateProgress(operationId, {
          processedRows: finalStats?.executed ?? statementIndex,
          processedBytes: fileSize,
          message: dryRun
            ? `Dry run complete — ${finalStats?.executed ?? 0} would execute, ${finalStats?.healed ?? 0} heals, ${finalStats?.skipped ?? 0} skips, ${finalStats?.quarantined ?? 0} quarantine. Rolled back.`
            : finalStats
              ? `Done — ${finalStats.executed} executed, ${finalStats.healed} healed, ${finalStats.skipped} skipped, ${finalStats.quarantined} quarantined`
              : `Done — ${statementIndex} statements`,
        })
        // Clean completion — remove checkpoint; nothing to resume.
        void deleteCheckpoint(operationId)
        this.completeOperation(operationId, 'completed')
      } catch (err: any) {
        if (useTransaction) {
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

      const runMode = this.resolveRunMode(options)
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
              }
              headers = mappedHeaders
              includedIndices = indices
            }

            if (options.createTable) {
              await this.createTableFromCSV(sqlSessionId, table, headers, dbType, schema)
            }
            if (options.truncateBefore) {
              await this.sqlService.executeQuery(sqlSessionId, `TRUNCATE TABLE ${quotedTable}`)
            }

            continue
          } else {
            headers = row.map((_, i) => `col_${i + 1}`)
            if (options.createTable) {
              await this.createTableFromCSV(sqlSessionId, table, headers, dbType, schema)
            }
            if (options.truncateBefore) {
              await this.sqlService.executeQuery(sqlSessionId, `TRUNCATE TABLE ${quotedTable}`)
            }
          }
        }

        const filteredRow = includedIndices
          ? includedIndices.map((idx) => (idx < row.length ? row[idx] : ''))
          : row

        rowBatch.push(filteredRow)

        if (rowBatch.length >= batchSize) {
          await this.insertCSVBatch(
            sqlSessionId, quotedTable, headers, rowBatch, dbType, runMode, operationId, processedRows, controller,
          )
          processedRows += rowBatch.length
          rowBatch = []

          const stats = this.operationStats.get(operationId)
          this.updateProgress(operationId, {
            processedRows,
            percentage: estimatedTotalRows > 0
              ? Math.min(99, Math.round((processedRows / estimatedTotalRows) * 100))
              : -1,
            message: stats
              ? `Imported ${processedRows} rows (${stats.healed} healed, ${stats.skipped} skipped, ${stats.quarantined} quarantined)`
              : `Imported ${processedRows} rows...`,
          })
        }
      }

      if (rowBatch.length > 0) {
        await this.insertCSVBatch(
          sqlSessionId, quotedTable, headers, rowBatch, dbType, runMode, operationId, processedRows, controller,
        )
        processedRows += rowBatch.length
      }

      const finalStats = this.operationStats.get(operationId)
      this.updateProgress(operationId, {
        processedRows,
        message: finalStats
          ? `Completed — ${processedRows} rows (${finalStats.healed} healed, ${finalStats.skipped} skipped, ${finalStats.quarantined} quarantined)`
          : `Completed: ${processedRows} rows imported`,
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
   * On batch failure, falls through to per-row insertion driven by the healing
   * engine so each row gets its own chance at a heal/skip/quarantine decision.
   */
  private async insertCSVBatch(
    sqlSessionId: string,
    quotedTable: string,
    headers: string[],
    rows: string[][],
    dbType: DatabaseType,
    runMode: HealRunMode,
    operationId: string,
    rowIndexBase: number,
    controller: AbortController,
  ): Promise<void> {
    const colNames = headers.map((h) => quoteIdentifier(h, dbType)).join(', ')

    if (dbType === 'mysql') {
      const placeholderRow = `(${headers.map(() => '?').join(', ')})`
      const allPlaceholders = rows.map(() => placeholderRow).join(', ')
      const sql = `INSERT INTO ${quotedTable} (${colNames}) VALUES ${allPlaceholders}`
      const params: unknown[] = []
      for (const row of rows) {
        for (let i = 0; i < headers.length; i++) {
          const val = i < row.length ? row[i] : null
          params.push(val === '' ? null : val)
        }
      }
      try {
        await this.sqlService.executeQuery(sqlSessionId, sql, params)
        // Bulk success — count every row as executed.
        const stats = this.operationStats.get(operationId)
        if (stats) stats.executed += rows.length
        return
      } catch {
        // Bulk failed — fall through to per-row healing path.
      }
    } else {
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
        const stats = this.operationStats.get(operationId)
        if (stats) stats.executed += rows.length
        return
      } catch {
        // Bulk failed — fall through to per-row healing path.
      }
    }

    // Per-row path — each row gets its own heal decision.
    await this.insertRowsIndividually(
      sqlSessionId, quotedTable, headers, rows, dbType, runMode, operationId, rowIndexBase, controller,
    )
  }

  /**
   * Per-row insertion routed through the healing engine. Each row that fails
   * consults decision memory / run mode / user and is healed, skipped, or
   * quarantined accordingly.
   */
  private async insertRowsIndividually(
    sqlSessionId: string,
    quotedTable: string,
    headers: string[],
    rows: string[][],
    dbType: DatabaseType,
    runMode: HealRunMode,
    operationId: string,
    rowIndexBase: number,
    controller: AbortController,
  ): Promise<void> {
    const colNames = headers.map((h) => quoteIdentifier(h, dbType)).join(', ')

    for (let r = 0; r < rows.length; r++) {
      this.checkCancelled(controller)

      const row = rows[r]
      const params: unknown[] = []
      const placeholders = dbType === 'mysql'
        ? headers.map(() => '?').join(', ')
        : headers.map((_, i) => `$${i + 1}`).join(', ')
      for (let i = 0; i < headers.length; i++) {
        const val = i < row.length ? row[i] : null
        params.push(val === '' ? null : val)
      }
      const sql = `INSERT INTO ${quotedTable} (${colNames}) VALUES (${placeholders})`

      await this.tryExecuteWithHealing(
        operationId,
        sqlSessionId,
        dbType,
        sql,
        rowIndexBase + r + 1,
        runMode,
        controller,
        params,
      )
    }
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
    referencedTables: string[]
    charsets: string[]
    insertCount: number
    createTableCount: number
    dropTableCount: number
  }> {
    const fileStat = await stat(filePath)
    const fileSize = fileStat.size

    // For .gz files, decompress through the same stream plumbing so the parser
    // sees plaintext SQL. Other archive types (.zip/.tar/.bz2) are rejected at
    // runSQLImport time; preflight here accepts them as "large file" without
    // scanning — the dangerous/table info would be meaningless anyway.
    const isGzip = /\.gz$/i.test(filePath)
    let stream: Readable
    if (isGzip) {
      const gunzip = createGunzip()
      createReadStream(filePath).pipe(gunzip)
      gunzip.setEncoding('utf-8')
      stream = gunzip
    } else {
      stream = createReadStream(filePath, { encoding: 'utf-8' })
    }

    const {
      count,
      dangerous,
      tables,
      charsets,
      insertCount,
      createTableCount,
      dropTableCount,
    } = await preScanStatements(stream)

    return {
      statementCount: count,
      dangerousStatements: dangerous,
      fileSize,
      referencedTables: tables,
      charsets,
      insertCount,
      createTableCount,
      dropTableCount,
    }
  }

  /**
   * Compare the tables named in a SQL file against the tables that exist in
   * the target database. Returns which are present and which would need to
   * be created (or may fail INSERTs for unknown-table errors).
   */
  async preflightCompareTables(
    sqlSessionId: string,
    candidateTables: string[],
  ): Promise<{ present: string[]; missing: string[] }> {
    if (candidateTables.length === 0) return { present: [], missing: [] }
    try {
      const existing = await this.sqlService.getTables(sqlSessionId)
      const existingSet = new Set(existing.map((t) => t.name.toLowerCase()))
      const present: string[] = []
      const missing: string[] = []
      for (const raw of candidateTables) {
        const norm = raw.toLowerCase()
        if (existingSet.has(norm)) present.push(raw)
        else missing.push(raw)
      }
      return { present, missing }
    } catch {
      // Don't fail preflight on introspection errors — return empty and let
      // the UI degrade gracefully.
      return { present: [], missing: [] }
    }
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
