# SQL Import/Export, Backup/Restore & Create Database — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add premium-grade database import/export, backup/restore, and database creation capabilities to Shellway's SQL client — matching or exceeding the UX quality of TablePlus, DBeaver, and DataGrip.

**Architecture:** Stream-based operations executed in Electron's main process via new IPC channels. All database operations go through the existing SSH tunnel infrastructure. Export generates files client-side from SQL query results. Import streams file content through the tunnel connection in batches. Backup/restore leverages remote `mysqldump`/`pg_dump` execution via SSH exec channels — a unique competitive advantage of Shellway's SSH-first architecture. Progress is reported via IPC events. A new `SQLDataTransferService` orchestrates all operations with cancellation support.

**Tech Stack:** Electron IPC, ssh2 (exec channels for remote dump), mysql2/pg (streaming queries), pg-query-stream (new dep for PG streaming), Node.js streams, React + Zustand (UI state), Tailwind CSS, Framer Motion (modals), lucide-react (icons).

---

## Review Findings Applied

This plan has been reviewed by QA, Security, and Architecture specialists. All critical and important findings have been incorporated:

- **Security:** Shell escaping for all SSH exec commands, env var password passing, removal of `extraFlags`, identifier validation, parameterized queries for CSV import, dangerous statement pre-scanning for SQL import, file path validation
- **Architecture:** Streaming query support via `streamQuery()` method, file-path-based exports (not string returns), `sqlSessionId` in progress events, main-process utility placement, `SQLService` injection into transfer service
- **QA:** Implementation order dependency fixes, PostgreSQL CREATE DATABASE reconnection flow, existing ContextMenu component reuse, last transfer result preservation

---

## Architecture Decision: How to Handle Backup/Restore

### The SSH Tunnel Problem

Shellway connects to databases **through SSH tunnels** using `ssh2` + `mysql2`/`pg`. This means:
- We **cannot** use local `mysqldump`/`pg_dump` binaries (they'd need direct DB access)
- We **can** execute commands on the remote server via `ssh2`'s `exec()` channel

### Decision: Dual-Strategy Approach

| Operation | Strategy | Why |
|-----------|----------|-----|
| **Export table data** (CSV/JSON/SQL) | Query via tunnel + generate client-side | Works everywhere, no binary dependency |
| **Export table structure** (CREATE TABLE) | Query INFORMATION_SCHEMA/pg_catalog + generate DDL | Pure SQL, no binary needed |
| **Full database dump** (structure + data) | Execute `mysqldump`/`pg_dump` on remote host via SSH exec | Most reliable for full backups, handles triggers/procedures/views correctly |
| **SQL file import** | Stream file → parse into statements → execute via tunnel | Works through any connection mode |
| **CSV import** | Read file → batch INSERT via tunnel | Works through any connection mode |
| **Database restore** | Stream file → execute `mysql`/`psql` on remote via SSH exec OR parse+execute via tunnel | Dual fallback: SSH exec preferred, tunnel fallback |
| **Create database** | Execute `CREATE DATABASE` via tunnel | Simple SQL statement |

### Competitive Advantage

Since Shellway is SSH-first, we can run `mysqldump`/`pg_dump` **on the remote server directly** — no need for local binaries. This is something most SQL clients can't do without manual SSH setup. We stream the dump output back through the SSH exec channel.

**Fallback for direct connections (no SSH):** For users connecting directly (no tunnel), we generate the dump ourselves using SQL queries + DDL generation. This covers structure + data but won't capture stored procedures, triggers, or events as reliably.

### SSH Exec Security Requirements (MANDATORY)

All SSH exec commands MUST follow these security rules:

1. **Shell-escape ALL interpolated values:**
```typescript
function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'"
}
```

2. **Pass passwords via environment variables, NEVER via command-line arguments:**
```bash
# MySQL — MYSQL_PWD env var (not visible in ps output):
MYSQL_PWD='escaped_pass' mysqldump -h host -P port -u user dbname

# PostgreSQL — PGPASSWORD env var:
PGPASSWORD='escaped_pass' pg_dump -h host -p port -U user dbname
```

3. **Validate ALL identifiers** (database names, table names) with strict regex BEFORE constructing commands:
```typescript
// MySQL: /^[a-zA-Z0-9_$]+$/
// PostgreSQL: /^[a-zA-Z_][a-zA-Z0-9_$]*$/
```

4. **No arbitrary CLI flags** — only expose named, validated options (no `extraFlags` field)

5. **Validate remote binary paths** — allowlist only: `/usr/bin/`, `/usr/local/bin/`, `/opt/homebrew/bin/`

6. **Stream backup output as raw Buffer** — never convert binary dumps to UTF-8 strings prematurely

### PostgreSQL DDL Generation Limitations

`SHOW CREATE TABLE` equivalent doesn't exist in PostgreSQL. Our DDL generation from `information_schema` is **lossy** — it misses:
- CHECK constraints, GENERATED columns, EXCLUSION constraints
- Custom types (enums, domains), PARTITION definitions
- Partial index predicates, column/table comments

**Mitigation:** When SSH is available, prefer `pg_dump --schema-only -t tablename` via exec channel for accurate DDL. Document the limitation in the export dialog when using non-SSH fallback.

---

## Feature Scope

### P0 — Must Ship (Phase 1)

1. **Create Database** — from DatabasePickerDialog
2. **Export Table to CSV/JSON/SQL** — enhanced version of existing ExportDialog
3. **Export Database Dump** — full SQL dump (structure + data)
4. **Import SQL Dump** — execute .sql file against database
5. **Import CSV** — column mapping, insert into existing table
6. **Context Menus** — right-click on table/database for import/export
7. **Progress Tracking** — real-time progress with cancellation

### P1 — Should Ship (Phase 2)

8. **Backup via SSH** — remote mysqldump/pg_dump execution
9. **Restore via SSH** — remote mysql/psql execution
10. **Export Options** — DROP TABLE, IF NOT EXISTS, structure-only, data-only
11. **CSV Import to New Table** — auto-create table from CSV headers
12. **Export from Query Result** — export any query editor result
13. **Multi-table Export** — select multiple tables for batch export
14. **Import Error Handling** — skip/null/abort strategies

### P2 — Nice to Have (Phase 3)

15. CSV delimiter auto-detection
16. .sql.gz import support
17. Export column selection
18. SQL keyword case options
19. Drag-and-drop CSV import

---

## New File Map

```
electron/
  services/
    SQLDataTransferService.ts    # NEW — orchestrates all import/export/backup/restore
    SQLService.ts                # MODIFY — add streamQuery() method
  utils/
    sqlParser.ts                 # NEW — SQL statement splitter (async iterator, main-process only)
    csvParser.ts                 # NEW — CSV parser utilities (main-process only)
    shellEscape.ts               # NEW — shell escaping for SSH exec commands
  ipc/
    sql.ipc.ts                   # MODIFY — add new IPC handlers, export getSSHClientForSession()

src/
  types/
    sql.ts                       # MODIFY — add transfer types
  stores/
    sqlStore.ts                  # MODIFY — add transfer state
  components/sql/
    ImportSQLDialog.tsx          # NEW — SQL dump import dialog
    ImportCSVDialog.tsx          # NEW — CSV import with column mapping
    ExportTableDialog.tsx        # NEW — enhanced table/database export
    BackupRestoreDialog.tsx      # NEW — SSH-based backup/restore
    CreateDatabaseDialog.tsx     # NEW — create database modal
    DatabasePickerDialog.tsx     # MODIFY — add "Create Database" button
    SchemaSidebar.tsx            # MODIFY — add context menus (use existing ContextMenu component)
    DataGrid.tsx                 # MODIFY — add export to context menu
    SQLView.tsx                  # MODIFY — wire up new dialogs
  utils/
    sqlExport.ts                 # MODIFY — add DDL generation, enhanced options

electron/preload.ts              # MODIFY — add new bridge methods
```

**New dependency:** `pg-query-stream` — required for PostgreSQL streaming exports of large tables.

---

## Type Definitions

Add to `src/types/sql.ts`:

```typescript
// ── Data Transfer ──

export type TransferOperation = 'export' | 'import' | 'backup' | 'restore'
export type TransferStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled'
export type ExportFormat = 'csv' | 'json' | 'sql'
export type ExportScope = 'table' | 'database' | 'query'
export type ImportMode = 'sql' | 'csv'
export type OnImportError = 'abort' | 'skip' | 'insert-null'

export interface ExportOptions {
  format: ExportFormat
  scope: ExportScope
  tables?: string[]           // specific tables (scope='database')
  /** SQL export options */
  includeStructure?: boolean  // CREATE TABLE statements
  includeData?: boolean       // INSERT statements
  addDropTable?: boolean      // DROP TABLE IF EXISTS before CREATE
  addIfNotExists?: boolean    // IF NOT EXISTS on CREATE
  batchSize?: number          // rows per INSERT (default 100)
  /** CSV export options */
  csvDelimiter?: ',' | '\t' | ';' | '|'
  csvIncludeHeaders?: boolean
  csvQuoteAll?: boolean
  /** JSON export options */
  jsonPrettyPrint?: boolean
}

export interface ImportSQLOptions {
  /** Execute within a single transaction */
  useTransaction?: boolean
  /** Continue on error vs abort */
  onError: OnImportError
  /** Target database (for USE statement override) */
  targetDatabase?: string
  /** Dangerous statements found during pre-scan (shown in confirmation dialog) */
  acknowledgedDangerousStatements?: boolean
}

// SECURITY: SQL import MUST pre-scan for dangerous statements before execution:
// DROP DATABASE/TABLE, TRUNCATE, ALTER/CREATE USER, GRANT/REVOKE,
// INTO OUTFILE/DUMPFILE, COPY TO, LOAD DATA INFILE, \! (psql shell escape)
// Show confirmation dialog listing all found dangerous statements.

export interface ImportCSVOptions {
  targetTable: string
  /** Column mapping: CSV column index → DB column name. null = skip column */
  columnMapping: (string | null)[]
  hasHeaderRow: boolean
  delimiter: ',' | '\t' | ';' | '|'
  encoding: 'utf-8' | 'utf-16' | 'latin1' | 'ascii'
  nullValue: string              // string that represents NULL (default: '')
  onError: OnImportError
  /** Create table if it doesn't exist */
  createTable?: boolean
  /** Batch size for INSERT statements */
  batchSize?: number
  /** Truncate table before import */
  truncateBefore?: boolean
}

// SECURITY: CSV import MUST use parameterized queries for all values.
// Table/column names must be identifier-escaped and validated against known schema.
// NEVER concatenate CSV values into SQL strings.

export interface BackupOptions {
  /** Remote command path override — MUST match allowlist: /usr/bin/, /usr/local/bin/, /opt/homebrew/bin/ */
  remoteBinaryPath?: string
  // NOTE: extraFlags was removed for security — all options are named fields only
  /** MySQL-specific */
  singleTransaction?: boolean
  addDropTable?: boolean
  addDropDatabase?: boolean
  extendedInserts?: boolean
  routines?: boolean
  events?: boolean
  triggers?: boolean
  /** PostgreSQL-specific */
  pgFormat?: 'plain' | 'custom' | 'tar'
  pgCompression?: number         // 0-9
  pgNoOwner?: boolean
  pgNoPrivileges?: boolean
  pgInserts?: boolean            // INSERT instead of COPY
  /** Common */
  structureOnly?: boolean
  dataOnly?: boolean
  tables?: string[]              // specific tables only
}

export interface RestoreOptions {
  /** Remote command path override */
  remoteBinaryPath?: string
  /** Create database before restore */
  createDatabase?: boolean
  /** Drop existing objects before restore */
  cleanFirst?: boolean
  /** Run in single transaction */
  singleTransaction?: boolean
}

export interface TransferProgress {
  operationId: string
  /** Required for routing progress events to the correct connection's store slice */
  sqlSessionId: string
  operation: TransferOperation
  status: TransferStatus
  /** 0-100, or -1 for indeterminate */
  percentage: number
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

export interface CreateDatabaseOptions {
  name: string
  /** MySQL: character set (e.g., 'utf8mb4') */
  charset?: string
  /** MySQL: collation (e.g., 'utf8mb4_unicode_ci') */
  collation?: string
  /** PostgreSQL: encoding (e.g., 'UTF8') */
  encoding?: string
  /** PostgreSQL: template database */
  template?: string
  /** PostgreSQL: LC_COLLATE */
  lcCollate?: string
  /** PostgreSQL: LC_CTYPE */
  lcCtype?: string
}

/** CSV file preview (first N rows + detected columns) */
export interface CSVPreview {
  headers: string[]
  sampleRows: string[][]         // first 10 rows
  totalLines: number             // approximate
  detectedDelimiter: ',' | '\t' | ';' | '|'
  detectedEncoding: string
  fileSize: number
}
```

---

## Task Breakdown

### Task 1: SQLDataTransferService (Main Process Core) + SQLService.streamQuery()

**Files:**
- Create: `electron/services/SQLDataTransferService.ts`
- Create: `electron/utils/sqlParser.ts`
- Create: `electron/utils/csvParser.ts`
- Create: `electron/utils/shellEscape.ts`
- Modify: `electron/services/SQLService.ts` — add `streamQuery()` method

#### SQLService.streamQuery() — NEW (CRITICAL for large table export)

The existing `executeQuery()` buffers all rows into a JS array — fine for interactive queries but will OOM on 10M+ row tables during export. We need a streaming path:

```typescript
// Add to SQLService
async streamQuery(sqlSessionId: string, query: string): Promise<Readable> {
  const active = this.connections.get(sqlSessionId)
  if (!active) throw new Error('Not connected')

  if (active.type === 'mysql') {
    // mysql2 supports .stream() on query results
    return active.conn.query(query).stream()
  } else {
    // PostgreSQL: use pg-query-stream (new dependency)
    const { default: QueryStream } = await import('pg-query-stream')
    const qs = new QueryStream(query, undefined, { batchSize: 500 })
    return active.conn.query(qs)
  }
}

// Also expose getConnectionType() — already exists — and getConnection() for raw access:
getConnection(sqlSessionId: string): ActiveConnection | undefined {
  return this.connections.get(sqlSessionId)
}
```

#### SQLDataTransferService

This is the backbone service. All import/export/backup/restore operations are orchestrated here. Each operation gets a unique `operationId` (via `crypto.randomUUID()`), runs asynchronously, and reports progress via events.

**Key design decisions:**
- **Constructor takes `SQLService` as dependency** — all DB work goes through `sqlService.executeQuery()` or `sqlService.streamQuery()`. Matches the `TransferQueue`/`SFTPService` pattern.
- Operations are **cancellable** via AbortController
- **Operation registry:** `Map<string, { controller: AbortController, progress: TransferProgress }>` — enforces one-active-per-session and enables cleanup
- Progress emitted via Electron's `BrowserWindow.webContents.send('sql:transfer:progress', sqlSessionId, progress)`
- Large file reads use Node.js `createReadStream` (not `readFileSync`)
- **Exports write directly to file** — never return content as a string. Accept `filePath` parameter, write via `createWriteStream`.
- SQL dump import uses the **statement splitter** from `electron/utils/sqlParser.ts` — an async iterator that handles DELIMITER changes, multi-line, quoted strings, and comments
- CSV import uses **parameterized batch INSERT** (MUST use `?` / `$N` placeholders, never string concatenation)
- DDL generation: MySQL uses `SHOW CREATE TABLE`, PostgreSQL uses `information_schema` reconstruction with SSH exec `pg_dump --schema-only` as preferred path when available
- Backup/restore via SSH exec requires access to the SSH connection (passed from IPC layer). Commands use `shellEscape()` for all interpolated values. Passwords passed via env vars only.
- **Pre-scan SQL imports** for dangerous statements before execution (DROP, TRUNCATE, GRANT, etc.)

**Core methods:**
```typescript
class SQLDataTransferService extends EventEmitter {
  constructor(private sqlService: SQLService) { super() }

  // Operation registry
  private operations = new Map<string, { controller: AbortController; progress: TransferProgress }>()

  // Export — writes directly to filePath, returns metadata only
  exportTable(sqlSessionId: string, table: string, filePath: string, options: ExportOptions): Promise<{ rowCount: number }>
  exportDatabase(sqlSessionId: string, filePath: string, options: ExportOptions): Promise<{ tableCount: number; rowCount: number }>
  exportQueryResult(result: DBQueryResult, table: string, dbType: DatabaseType, filePath: string, options: ExportOptions): Promise<void>

  // Import
  importSQL(sqlSessionId: string, filePath: string, options: ImportSQLOptions): Promise<TransferProgress>
  importCSV(sqlSessionId: string, filePath: string, options: ImportCSVOptions): Promise<TransferProgress>
  previewCSV(filePath: string): Promise<CSVPreview>
  preScanSQL(filePath: string): Promise<{ statementCount: number; dangerousStatements: string[]; fileSize: number }>

  // DDL Generation
  generateCreateTable(sqlSessionId: string, table: string, schema?: string): Promise<string>
  generateDatabaseDump(sqlSessionId: string, filePath: string, options: ExportOptions): Promise<void>

  // Backup/Restore (SSH exec) — sshClient passed from IPC layer
  backupViaSSH(sshClient: SSHClient, database: string, dbType: DatabaseType, dbConfig: DBConfig, filePath: string, options: BackupOptions): Promise<void>
  restoreViaSSH(sshClient: SSHClient, filePath: string, database: string, dbType: DatabaseType, dbConfig: DBConfig, options: RestoreOptions): Promise<TransferProgress>

  // Create Database — with server-side identifier validation
  createDatabase(sqlSessionId: string, options: CreateDatabaseOptions): Promise<{ success: boolean; error?: string }>

  // Control
  cancel(operationId: string): void
  getProgress(operationId: string): TransferProgress | null
  hasActiveOperation(sqlSessionId: string): boolean
}
```

**SQL Statement Splitter Logic (in `electron/utils/sqlParser.ts`):**

The splitter is an **async generator** that reads from a `Readable` stream — never loads the full file into memory:

```typescript
async function* splitSQLStatements(stream: Readable): AsyncGenerator<string> {
  // Yields individual SQL statements one at a time
}
```

- Split on `;` but respect:
  - String literals (`'...'`, `"..."`)
  - Backtick identifiers (MySQL)
  - `$$` delimiters (PostgreSQL function bodies)
  - `DELIMITER` changes (MySQL dumps use `DELIMITER ;;` for procedures)
  - Multi-line comments (`/* ... */`)
  - Single-line comments (`-- ...`, `# ...`)
- Skip empty statements
- Track state machine: `normal | single_quote | double_quote | backtick | dollar_dollar | line_comment | block_comment`
- Buffer via a line-by-line `readline` interface on the stream for memory efficiency

**Pre-scan for Dangerous Statements (SECURITY — MANDATORY):**

Before executing any SQL import, scan the file and report dangerous patterns:

```typescript
const DANGEROUS_PATTERNS = [
  /^\s*DROP\s+(DATABASE|SCHEMA|TABLE|INDEX|VIEW|FUNCTION|PROCEDURE|TRIGGER)/i,
  /^\s*TRUNCATE\s/i,
  /^\s*DELETE\s+FROM\s+\S+\s*;?\s*$/i,  // DELETE without WHERE
  /^\s*ALTER\s+USER/i,
  /^\s*CREATE\s+USER/i,
  /^\s*GRANT\s/i,
  /^\s*REVOKE\s/i,
  /INTO\s+(OUTFILE|DUMPFILE)/i,          // MySQL file exfiltration
  /^\s*COPY\s+.*\s+TO\s+/i,              // PostgreSQL file exfiltration
  /^\s*\\!/,                               // psql shell escape (BLOCK unconditionally)
  /^\s*LOAD\s+DATA\s+INFILE/i,           // MySQL file read
]
```

The import dialog shows a confirmation dialog listing all found dangerous statements before proceeding.

**DDL Generation (CREATE TABLE from schema introspection):**

For MySQL:
```sql
SHOW CREATE TABLE `table_name`
```
This returns the exact CREATE TABLE statement — no need to reconstruct it.

For PostgreSQL (when SSH is available — preferred):
```bash
pg_dump --schema-only -t tablename dbname
```
Via SSH exec channel for accurate DDL including all constraints, comments, and PG-specific features.

For PostgreSQL (fallback — no SSH):
- Query `information_schema.columns` for column definitions
- Query `pg_get_constraintdef()` for CHECK constraints
- Query `pg_get_indexdef()` for index definitions
- Query `pg_get_serial_sequence()` for sequences
- Query `information_schema.table_constraints` + `key_column_usage` for PK/FK/UNIQUE
- Assemble the CREATE TABLE statement
- **Document as lossy** — misses PARTITION definitions, custom types/enums, GENERATED columns

---

### Task 2: IPC Handlers & Preload Bridge

**Files:**
- Modify: `electron/ipc/sql.ipc.ts`
- Modify: `electron/preload.ts`

**New IPC channels:**

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `sql:export` | invoke | Export table/database/query to file |
| `sql:import:sql` | invoke | Import SQL dump file |
| `sql:import:sql-prescan` | invoke | Pre-scan SQL file for dangerous statements |
| `sql:import:csv` | invoke | Import CSV file |
| `sql:import:csv-preview` | invoke | Preview CSV file (headers, sample rows) |
| `sql:backup` | invoke | Backup database via SSH exec |
| `sql:restore` | invoke | Restore database via SSH exec |
| `sql:createDatabase` | invoke | Create a new database |
| `sql:getCharsets` | invoke | Get available charsets (for create db dialog) |
| `sql:getCollations` | invoke | Get available collations for a charset |
| `sql:generateDDL` | invoke | Generate CREATE TABLE DDL |
| `sql:transfer:cancel` | invoke | Cancel a running transfer operation |
| `sql:transfer:progress` | event (main→renderer) | Progress updates — includes `sqlSessionId` for routing |

**MANDATORY: Input Validation on Every IPC Handler**

Every new IPC handler MUST validate inputs before passing to the service, following the pattern established in `sql:connect` (lines 50-67 of sql.ipc.ts). Example:

```typescript
function validateExportOptions(opts: unknown): ExportOptions {
  if (!opts || typeof opts !== 'object') throw new Error('Invalid options')
  const o = opts as Record<string, unknown>
  if (!['csv', 'json', 'sql'].includes(o.format as string)) throw new Error('Invalid format')
  if (!['table', 'database', 'query'].includes(o.scope as string)) throw new Error('Invalid scope')
  if (o.batchSize !== undefined) {
    const bs = Number(o.batchSize)
    if (!Number.isInteger(bs) || bs < 1 || bs > 10000) throw new Error('batchSize must be 1-10000')
  }
  if (Array.isArray(o.tables)) {
    for (const t of o.tables) {
      if (typeof t !== 'string' || !/^[a-zA-Z0-9_$]+$/.test(t))
        throw new Error(`Invalid table name: ${t}`)
    }
  }
  return o as ExportOptions
}

function validateBackupOptions(opts: unknown): BackupOptions {
  // ... similar validation ...
  if ((opts as any).remoteBinaryPath) {
    const p = (opts as any).remoteBinaryPath as string
    const ALLOWED_PREFIXES = ['/usr/bin/', '/usr/local/bin/', '/opt/homebrew/bin/']
    if (!ALLOWED_PREFIXES.some(prefix => p.startsWith(prefix)))
      throw new Error('Binary path must be in /usr/bin/, /usr/local/bin/, or /opt/homebrew/bin/')
    if (!/^[a-zA-Z0-9_./-]+$/.test(p))
      throw new Error('Invalid characters in binary path')
  }
  return opts as BackupOptions
}
```

**SSH Client Resolution for Backup/Restore (export as helper function):**

```typescript
// Add to sql.ipc.ts — exported for use by other handlers
export function getSSHClientForSession(sqlSessionId: string): SSHClient | null {
  // Mode 3: Ephemeral SSH tunnel — client is in ephemeralSSH map
  const ephemeral = ephemeralSSH.get(sqlSessionId)
  if (ephemeral) return ephemeral.client

  // Mode 2: SSH session tunnel — resolve via tunnelMap → connectionId → SSHService
  const tunnel = tunnelMap.get(sqlSessionId)
  if (tunnel) {
    const sshService = getSSHService()
    return sshService.get(tunnel.connectionId) ?? null
  }

  // Mode 1: Direct connection — no SSH client available
  return null
}
```

The IPC handler for `sql:backup` / `sql:restore` calls this function and returns an error if null: `{ success: false, error: 'Backup requires an SSH connection. Direct database connections do not support remote backup.' }`

**Preload bridge additions:**
```typescript
sql: {
  // ... existing methods ...

  // Data Transfer
  exportData: (sqlSessionId: string, filePath: string, options: unknown) =>
    ipcRenderer.invoke('sql:export', sqlSessionId, filePath, options),
  importSQL: (sqlSessionId: string, filePath: string, options: unknown) =>
    ipcRenderer.invoke('sql:import:sql', sqlSessionId, filePath, options),
  preScanSQL: (filePath: string) =>
    ipcRenderer.invoke('sql:import:sql-prescan', filePath),
  importCSV: (sqlSessionId: string, filePath: string, options: unknown) =>
    ipcRenderer.invoke('sql:import:csv', sqlSessionId, filePath, options),
  previewCSV: (filePath: string) =>
    ipcRenderer.invoke('sql:import:csv-preview', filePath),

  // Backup/Restore
  backup: (sqlSessionId: string, database: string, filePath: string, options: unknown) =>
    ipcRenderer.invoke('sql:backup', sqlSessionId, database, filePath, options),
  restore: (sqlSessionId: string, database: string, filePath: string, options: unknown) =>
    ipcRenderer.invoke('sql:restore', sqlSessionId, database, filePath, options),

  // Database management
  createDatabase: (sqlSessionId: string, options: unknown) =>
    ipcRenderer.invoke('sql:createDatabase', sqlSessionId, options),
  getCharsets: (sqlSessionId: string) =>
    ipcRenderer.invoke('sql:getCharsets', sqlSessionId),
  getCollations: (sqlSessionId: string, charset: string) =>
    ipcRenderer.invoke('sql:getCollations', sqlSessionId, charset),
  generateDDL: (sqlSessionId: string, table: string, schema?: string) =>
    ipcRenderer.invoke('sql:generateDDL', sqlSessionId, table, schema),

  // Transfer control
  cancelTransfer: (operationId: string) =>
    ipcRenderer.invoke('sql:transfer:cancel', operationId),
  onTransferProgress: (callback: (sqlSessionId: string, progress: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, sqlSessionId: string, progress: unknown) =>
      callback(sqlSessionId, progress)
    ipcRenderer.on('sql:transfer:progress', handler)
    return () => ipcRenderer.removeListener('sql:transfer:progress', handler)
  }
}
```

Note: `connectionId` removed from backup/restore bridge — the IPC handler resolves the SSH client internally via `getSSHClientForSession(sqlSessionId)`. The renderer doesn't need to know about SSH tunnel modes.

---

### Task 3: Create Database Dialog

**Files:**
- Create: `src/components/sql/CreateDatabaseDialog.tsx`
- Modify: `src/components/sql/DatabasePickerDialog.tsx` — add "New Database" button

**UI Design:**
- Modal with title "Create Database"
- Database name input (required, validated: no spaces, no special chars except `_` and `-`)
- For MySQL:
  - Character Set dropdown (fetched from `SHOW CHARACTER SET`, default: `utf8mb4`)
  - Collation dropdown (fetched from `SHOW COLLATION WHERE Charset = ?`, default: `utf8mb4_unicode_ci`)
- For PostgreSQL:
  - Encoding dropdown (UTF8, LATIN1, SQL_ASCII, etc., default: `UTF8`)
  - Template dropdown (`template0`, `template1`, default: `template1`)
  - LC_COLLATE input (optional, default: system)
  - LC_CTYPE input (optional, default: system)
- "Create" and "Cancel" buttons
- Error display
- On success:
  - **MySQL:** auto-switch to new database via `switchDatabase()` + refresh schema
  - **PostgreSQL:** show notification "Database created. Reconnecting..." → disconnect current session → reconnect with new database name (reuse the existing `handleDatabaseSelected` reconnection pattern from SQLView.tsx). PostgreSQL cannot switch databases on an existing connection.
- **Server-side validation (MANDATORY):**
  - Database name: `/^[a-zA-Z_][a-zA-Z0-9_]*$/` (reject hyphens, spaces, special chars)
  - Charset/collation: validated against the fetched list from `sql:getCharsets`/`sql:getCollations`
  - All identifiers properly quoted: backtick for MySQL, double-quote for PostgreSQL

**Integration with DatabasePickerDialog:**
Add a `+ New Database` button at the bottom of the dialog (next to Cancel/Open). Clicking it opens CreateDatabaseDialog. On successful creation, the new database appears in the list and is auto-selected.

---

### Task 4: Enhanced Export Dialog (ExportTableDialog)

**Files:**
- Create: `src/components/sql/ExportTableDialog.tsx`
- Keep existing `ExportDialog.tsx` for backward compatibility (query result export)

**UI Design:**
A more comprehensive export dialog that replaces the simple ExportDialog for table-level exports:

- **Scope selector:** "Selected Table" / "All Tables" / "Selected Tables" (multi-select)
- **Format selector:** CSV | JSON | SQL
- **SQL-specific options section:**
  - [x] Include structure (CREATE TABLE) — default: on
  - [x] Include data (INSERT) — default: on
  - [x] Add DROP TABLE IF EXISTS — default: off
  - [x] Add IF NOT EXISTS — default: on
  - Batch size: [100] rows per INSERT
  - Insert mode: INSERT / REPLACE / INSERT...ON DUPLICATE KEY UPDATE (MySQL) / INSERT...ON CONFLICT (PostgreSQL)
- **CSV-specific options section:**
  - Delimiter: Comma | Tab | Semicolon | Pipe
  - [x] Include column headers — default: on
  - [x] Quote all values — default: off
- **JSON-specific options:**
  - [x] Pretty print — default: on
- **Output:** File save dialog → write to disk
- **Progress bar** for large exports (multi-table)
- **Summary** on completion: "Exported 3 tables, 45,230 rows to /path/to/file.sql"

---

### Task 5: Import SQL Dialog

**Files:**
- Create: `src/components/sql/ImportSQLDialog.tsx`

**UI Design:**
- **File selector** — "Choose .sql file" button → native file open dialog (filters: .sql, .txt)
- **File info display** — filename, size, last modified
- **Options:**
  - [x] Execute in transaction — default: off (large dumps can't fit in one transaction)
  - On error: [Abort] / Skip row / Insert NULL
  - Target database: [current database] (read-only, informational)
- **Warning banner** for production databases (reuse `SafeModeIndicator` pattern)
- **Import button** — starts import
- **Progress section (appears during import):**
  - Progress bar with percentage
  - "Executing statement 4,521 of ~12,000" 
  - Current statement preview (truncated to 100 chars)
  - Elapsed time
  - Errors encountered (collapsible list)
  - **Cancel button**
- **Completion summary:**
  - Statements executed: 12,000
  - Errors: 0
  - Time: 2m 34s

**Technical notes:**
- File is read in the main process (not renderer — security: `contextIsolation`)
- Renderer sends file path, main process reads and streams
- Statements split by the SQL statement splitter (handles DELIMITER, multi-line, etc.)
- Progress emitted every 50 statements or every 500ms, whichever comes first
- Cancellation sets an AbortController signal; the statement loop checks it between batches

---

### Task 6: Import CSV Dialog

**Files:**
- Create: `src/components/sql/ImportCSVDialog.tsx`

**UI Design — 2-panel layout:**

**Left panel: Settings**
- **File selector** — "Choose .csv file" button
- File info: name, size, ~rows
- **Target table:** dropdown of existing tables OR "Create new table" option
- **Delimiter:** Auto-detected (shown) with manual override (Comma/Tab/Semicolon/Pipe)
- **Encoding:** UTF-8 (default) / UTF-16 / Latin1 / ASCII
- [x] First row is header — default: on
- **NULL value:** text input, default: empty string
- On error: [Abort] / Skip row / Insert NULL
- Batch size: [100]

**Right panel: Column Mapping (DataGrip-inspired)**
- Table with 3 columns:
  - **CSV Column** — header name (or "Column 1", "Column 2" if no headers)
  - **DB Column** — dropdown of target table columns + "(skip)" option
  - **Sample Data** — first 3 values from the CSV, comma-separated preview
- Auto-mapping: CSV headers are matched to DB column names (case-insensitive, underscore-tolerant)
- Unmapped columns show yellow warning
- "Map All" / "Clear All" buttons

**Bottom: Preview**
- First 5 rows rendered as a mini table
- Shows how data will look after mapping

**Import button + progress (same pattern as SQL import)**

**Technical notes:**
- CSV preview is generated in main process: read first 10 rows + detect delimiter + count approximate lines
- Preview data sent to renderer via `sql:import:csv-preview` IPC
- Column mapping is entirely renderer-side state
- Import sends mapping + options to main process which streams the file

---

### Task 7: Backup/Restore Dialog (SSH-based)

**Files:**
- Create: `src/components/sql/BackupRestoreDialog.tsx`

**This is only available when connected via SSH tunnel (modes 2 or 3).**

**UI Design — tabbed: Backup | Restore**

**Backup tab:**
- **Database:** [current database] (read-only)
- **Output file:** File save dialog → local path
- **MySQL options:**
  - [x] Single transaction (--single-transaction) — default: on
  - [x] Add DROP TABLE (--add-drop-table) — default: on
  - [x] Extended inserts (--extended-insert) — default: on
  - [x] Routines (--routines) — default: off
  - [x] Events (--events) — default: off
  - [x] Triggers (--triggers) — default: on
  - Structure only / Data only / Both — default: Both
  - Tables: All / Select specific (multi-select)
- **PostgreSQL options:**
  - Format: Plain SQL / Custom / Tar — default: Plain
  - Compression: 0-9 — default: 0 (plain) or 6 (custom/tar)
  - [x] No owner (--no-owner) — default: off
  - [x] No privileges (--no-privileges) — default: off
  - [x] Use INSERT instead of COPY (--inserts) — default: off
  - Structure only / Data only / Both — default: Both
  - Tables: All / Select specific
- **"Backup" button** → starts remote execution
- **Progress:** streaming output from remote command (line-by-line)
- **Cancel button** → sends SIGTERM to remote process

**Restore tab:**
- **File selector** — .sql / .dump / .tar / .sql.gz
- **Database:** [current database]
- **Options:**
  - [x] Clean (drop existing objects) — default: off
  - [x] Single transaction — default: off
- **"Restore" button**
- **Progress:** streaming output
- **Cancel button**

**Technical notes:**
- Backup command constructed: `mysqldump -h 127.0.0.1 -P 3306 -u user -p'pass' [options] dbname`
  - Connection details come from the stored SQL config
  - Password is passed securely (environment variable via SSH exec, not command line when possible)
- Output is streamed back through the SSH exec channel
- For MySQL: stream goes to local file via Node.js `createWriteStream`
- For PostgreSQL: `pg_dump` with same pattern
- Restore: stream local file content TO the SSH exec channel running `mysql`/`psql`
- Remote binary detection: first try `which mysqldump` / `which pg_dump` via SSH exec
  - If not found, show error with manual path input option

---

### Task 8: Context Menus

**Files:**
- Modify: `src/components/sql/SchemaSidebar.tsx` — table right-click + database right-click
- Modify: `src/components/sql/DataGrid.tsx` — add export options

**SchemaSidebar table context menu items:**
- Export Table → CSV / JSON / SQL (sub-menu or opens ExportTableDialog with table pre-selected)
- Import Data → From CSV (opens ImportCSVDialog with table pre-selected)
- Copy Table Name
- separator
- Drop Table (with confirmation, respects production safety mode)

**SchemaSidebar database selector context menu (right-click on db name):**
- Export Database (all tables)
- Import SQL Dump
- separator
- Backup Database (only if SSH connected)
- Restore Database (only if SSH connected)
- separator
- Create New Database

**DataGrid context menu additions:**
- Export Results → CSV / JSON / SQL (existing ExportDialog)

**Implementation:**
Use the **existing** `<ContextMenu>` component at `src/components/ui/ContextMenu.tsx` — it already has portal positioning, framer-motion animation, keyboard handling, and click-outside-to-close. Wrap each `TableRow` in SchemaSidebar with an `onContextMenu` handler that populates a dynamic menu items array based on the right-clicked table.

---

### Task 9: SQL Utilities Enhancement

**Files:**
- Modify: `src/utils/sqlExport.ts` — add DDL generation helpers, enhanced options (renderer-safe, for in-memory query result export)
- Create: `electron/utils/sqlParser.ts` — SQL statement splitter as async generator (main-process only, uses Node.js streams)
- Create: `electron/utils/csvParser.ts` — CSV parser utilities (main-process only, uses Node.js streams)
- Create: `electron/utils/shellEscape.ts` — shell escaping for SSH exec commands

**sqlExport.ts additions (renderer-side, for existing ExportDialog):**
- `generateCreateTableSQL(columns, indexes, foreignKeys, table, dbType)` — builds CREATE TABLE from schema data
- `generateDropTableSQL(table, dbType)` — DROP TABLE IF EXISTS
- Enhanced `exportToSQL()` with all new options (DROP, IF NOT EXISTS, insert mode)
- Unify delimiter type: add `'|'` to existing `CSVOptions.delimiter` union

**electron/utils/sqlParser.ts (main-process only):**
- `splitSQLStatements(stream: Readable): AsyncGenerator<string>` — async iterator, never loads full file
- `scanDangerousStatements(stream: Readable): Promise<string[]>` — returns list of dangerous statement descriptions
- `countStatements(stream: Readable): Promise<number>` — approximate statement count for progress calculation

**electron/utils/csvParser.ts (main-process only):**
- `parseCSVStream(stream: Readable, delimiter: string): AsyncGenerator<string[]>` — RFC 4180 compliant, streaming
- `detectCSVDelimiter(sample: string): ',' | '\t' | ';' | '|'` — frequency analysis on first 5 lines
- `inferColumnTypes(sampleRows: string[][]): string[]` — guess MySQL/PG types from data (default to VARCHAR(255)/TEXT, let users override)

**electron/utils/shellEscape.ts:**
- `shellEscape(arg: string): string` — wraps in single quotes, escapes embedded single quotes
- `validateIdentifier(name: string, dbType: DatabaseType): void` — regex validation for DB/table names
- `validateBinaryPath(path: string): void` — allowlist prefix validation

---

### Task 10: Store & State Management

**Files:**
- Modify: `src/stores/sqlStore.ts`

**Add to `SQLConnectionSlice`:**
```typescript
/** Active transfer operation for this connection (null when idle) */
activeTransfer: TransferProgress | null
/** Preserved after transfer completes — survives re-renders for completion summary UI */
lastTransferResult: TransferProgress | null
setActiveTransfer: (progress: TransferProgress | null) => void
clearLastTransferResult: () => void
```

**One-active-per-connection enforcement:** The service rejects new operations when `hasActiveOperation(sqlSessionId)` returns true. The UI should also disable import/export buttons when `activeTransfer !== null`.

**IPC event listener in `SQLView.tsx` (per connection):**
Listen for `sql:transfer:progress` events, filter by `sqlSessionId`, and route to this connection's store slice:

```typescript
useEffect(() => {
  const unsub = window.novadeck.sql.onTransferProgress((eventSessionId, progress) => {
    if (eventSessionId === sqlSessionId) {
      setActiveTransfer(progress as TransferProgress)
      if ((progress as TransferProgress).status === 'completed' ||
          (progress as TransferProgress).status === 'failed') {
        // Move to lastTransferResult so completion summary persists
        setActiveTransfer(null)
        // Store as lastTransferResult handled inside setActiveTransfer logic
      }
    }
  })
  return unsub
}, [sqlSessionId])
```

---

### Task 11: Wire Everything Together in SQLView

**Files:**
- Modify: `src/components/sql/SQLView.tsx`

**New state:**
```typescript
const [showImportSQL, setShowImportSQL] = useState(false)
const [showImportCSV, setShowImportCSV] = useState(false)
const [showExportTable, setShowExportTable] = useState(false)
const [showBackupRestore, setShowBackupRestore] = useState(false)
const [showCreateDatabase, setShowCreateDatabase] = useState(false)
```

**Dialog renders (at bottom of JSX):**
All dialogs are conditionally rendered, passing `sqlSessionId`, `connectionId`, `currentDatabase`, `dbType`, etc.

**Keyboard shortcuts (useSQLShortcuts):**
- Cmd+Shift+E → Export dialog
- Cmd+Shift+I → Import dialog

---

## Implementation Order

The tasks should be implemented in this dependency order (corrected for all cross-dependencies):

```
Phase 1 (Foundation — sequential, everything depends on these):
  Task 9:  SQL Utilities Enhancement       ← parser, CSV parser, shellEscape (no dependencies)
  Task 1:  SQLDataTransferService          ← depends on Task 9 parsers
  Task 10: Store & State Management        ← foundational, every dialog reads from the store
  Task 2:  IPC Handlers + Preload Bridge   ← depends on Task 1, wires service to renderer

Phase 2 (Core Features — can be parallelized after Phase 1):
  Task 3:  Create Database Dialog          ← independent, needs Task 2 + Task 10
  Task 4:  Export Table Dialog             ← depends on Task 1, 2, 9
  Task 5:  Import SQL Dialog               ← depends on Task 1, 2, 9

Phase 3 (Core Features continued):
  Task 6:  Import CSV Dialog               ← depends on Task 1, 2, 9 (can parallel with Phase 2 but more complex)
  Task 8:  Context Menus                   ← depends on all dialogs existing from Phases 2-3

Phase 4 (Integration):
  Task 11: Wire in SQLView                 ← final integration of all dialogs + shortcuts

Phase 5 (Advanced — SSH-based):
  Task 7:  Backup/Restore Dialog           ← requires SSH exec integration + Task 2's getSSHClientForSession()
```

**Critical dependency chain:** Task 9 → Task 1 → Task 2 → all UI tasks.
**Parallelizable:** Tasks 3, 4, 5 can be implemented simultaneously after Phase 1 completes.

---

## Testing Strategy

Since no test framework is configured, verification is:

1. **TypeScript compilation:** `npm run typecheck` must pass after each task
2. **Build:** `npm run build` must succeed
3. **Manual testing matrix:**

| Test Case | MySQL | PostgreSQL |
|-----------|-------|------------|
| Create database from picker dialog | | |
| Export single table to CSV | | |
| Export single table to JSON | | |
| Export single table to SQL (structure + data) | | |
| Export all tables to SQL dump | | |
| Import .sql dump file (< 1MB) | | |
| Import .sql dump file (> 50MB) — verify streaming | | |
| Import CSV (with headers, auto-mapping) | | |
| Import CSV (create new table) | | |
| Cancel import mid-operation | | |
| Export from query editor result | | |
| Right-click table → Export | | |
| Right-click table → Import CSV | | |
| Backup via SSH (mysqldump/pg_dump) | | |
| Restore via SSH | | |
| Production safety confirmation | | |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Large file import causes OOM | Stream-based reading via async generators. Never load entire file into memory. Statement splitter works on `Readable` streams. |
| Large table export causes OOM | Use `streamQuery()` method with cursor-based pagination. Write each batch directly to `WriteStream`. Never accumulate full result. |
| SQL statement splitter fails on edge cases | Handle DELIMITER changes (MySQL dumps), $$ blocks (PostgreSQL), nested quotes. Test with real mysqldump/pg_dump output. |
| SSH exec command injection | Shell-escape ALL values via `shellEscape()`. Pass passwords via env vars only. Validate identifiers. Remove `extraFlags`. |
| SSH exec not available (direct connection) | Gracefully disable backup/restore buttons. Show "Requires SSH connection" tooltip. Fall back to SQL-based dump generation. |
| Remote mysqldump/pg_dump not installed | Detect via `which` command first. Show clear error with manual path option (path validated against allowlist). |
| PostgreSQL can't switch databases | Create database dialog reconnects for PG (reuses `handleDatabaseSelected` pattern). |
| Malicious SQL in import files | Pre-scan for dangerous statements (DROP, TRUNCATE, GRANT, etc.). Show confirmation dialog. Block psql `\!` commands unconditionally. |
| Import corrupts data | Always offer transaction mode. Show warning when transaction mode is off: "Partial changes cannot be rolled back." Show confirmation for production databases. |
| CSV import SQL injection | MANDATORY: use parameterized queries (`?`/`$N` placeholders). Never concatenate CSV values into SQL. |
| Export of huge tables (millions of rows) | `streamQuery()` + `createWriteStream`. Progress indicator. Method returns `Promise<void>` not `Promise<string>`. |
| Race condition: two operations on same connection | `hasActiveOperation()` guard in service. Reject new operations while one is active. UI disables buttons. |
| Sensitive data in export files | Warn for production databases. Set `0o600` file permissions. Show security reminder after export completes. |
| App crash mid-import | Acknowledged as non-goal for V1. Document that partial imports cannot be rolled back unless transaction mode was used. |
| SSH backup/restore exit code | Check `exit` event status code from SSH exec channel. Non-zero = failure. Stream stderr for error messages. |
| File path traversal | Use native file dialogs for path selection. Validate paths in IPC handlers. |

---

## MySQL Import/Export Safety Wrappers

For MySQL SQL exports, wrap with standard safety statements:
```sql
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO';
-- ... dump content ...
SET SQL_MODE=@OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
```

For MySQL SQL imports, detect and respect these wrappers. If importing raw INSERT statements without wrappers, offer to prepend `SET FOREIGN_KEY_CHECKS=0` for imports that may have FK ordering issues.

---

## UX Guidelines

1. **Entry points are consistent:** Context menu (primary), toolbar (secondary), keyboard shortcut (power users)
2. **Minimal steps for common operations:** Export table = right-click → Export → pick format → save
3. **Preview before commit:** CSV import shows mapped data preview. SQL import shows statement count.
4. **Progress is always visible:** Non-blocking modal with progress bar, current operation, elapsed time
5. **Cancellation always available:** Every long-running operation has a Cancel button
6. **Errors are actionable:** "Failed to import row 4521: duplicate key 'email'" with option to skip/retry
7. **Smart defaults:** UTF-8, comma delimiter, headers included, structure+data, batch inserts
8. **Production safety:** Reuse the existing `SafeModeIndicator` pattern for all destructive operations
