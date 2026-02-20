# Phase 1: Foundation — Types, Service, IPC, Preload, Tab Wiring

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Depends on:** Nothing
> **Back to:** [Overview](./00-overview.md)

---

## Task 1.1: SQL Type Definitions

**Files:**
- Create: `src/types/sql.ts`

**Step 1: Create the type file**

```typescript
// src/types/sql.ts

// ── Database connection config (stored per-session or entered at runtime) ──

export type DatabaseType = 'mysql' | 'postgres'

export interface DatabaseConnectionConfig {
  id: string
  name: string
  type: DatabaseType
  host: string              // Remote DB host (e.g., 127.0.0.1, db.internal)
  port: number              // Remote DB port (e.g., 3306, 5432)
  username: string
  password: string
  database: string          // Default database/schema to connect to
  useSSHTunnel: boolean     // Whether to route through the SSH connection
  ssl?: boolean
}

// ── Schema introspection types ──

export interface SchemaDatabase {
  name: string
  isActive: boolean
}

export interface SchemaTable {
  name: string
  type: 'table' | 'view'
  schema?: string            // For Postgres schemas (public, etc.)
  rowCount?: number          // Approximate row count
}

export interface SchemaColumn {
  name: string
  type: string               // e.g., "varchar(255)", "int", "timestamp"
  nullable: boolean
  defaultValue: string | null
  isPrimaryKey: boolean
  isAutoIncrement: boolean
  extra?: string             // MySQL extra info
  comment?: string
}

export interface SchemaIndex {
  name: string
  columns: string[]
  isUnique: boolean
  isPrimary: boolean
  type: string               // BTREE, HASH, etc.
}

export interface SchemaForeignKey {
  name: string
  columns: string[]
  referencedTable: string
  referencedColumns: string[]
  onUpdate: string
  onDelete: string
}

// ── Query execution ──

export interface QueryField {
  name: string
  type: string
  table?: string
}

export interface QueryResult {
  fields: QueryField[]
  rows: Record<string, unknown>[]
  rowCount: number
  affectedRows?: number
  executionTimeMs: number
  truncated: boolean          // True if we capped the result set
  totalRowEstimate?: number   // Approximate total for pagination
}

export interface QueryError {
  message: string
  code?: string
  position?: number           // Character position in query
  line?: number
}

// ── Pagination ──

export interface PaginationState {
  page: number
  pageSize: number             // Default 200
  totalRows: number
  totalPages: number
}

// ── Filter system (TablePlus-style) ──

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'greater_or_equal'
  | 'less_or_equal'
  | 'is_null'
  | 'is_not_null'
  | 'in'
  | 'not_in'
  | 'between'
  | 'raw_sql'

export interface TableFilter {
  id: string
  enabled: boolean
  column: string               // Column name, or '' for raw SQL
  operator: FilterOperator
  value: string
  value2?: string              // For 'between' operator
}

// ── Inline editing / staged changes ──

export type ChangeType = 'update' | 'insert' | 'delete'

export interface StagedChange {
  id: string
  type: ChangeType
  table: string
  // For updates: which row (by PK) and which columns changed
  primaryKey: Record<string, unknown>
  changes?: Record<string, { old: unknown; new: unknown }>
  // For inserts: the new row data
  newRow?: Record<string, unknown>
  // Generated SQL preview
  sql: string
}

// ── Query history ──

export interface QueryHistoryEntry {
  id: string
  query: string
  database: string
  executedAt: number
  executionTimeMs: number
  rowCount?: number
  error?: string
  isFavorite: boolean
}

// ── SQL connection state ──

export type SQLConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

export interface SQLConnectionState {
  status: SQLConnectionStatus
  config?: DatabaseConnectionConfig
  currentDatabase: string
  error?: string
  tunnelPort?: number          // Local port if using SSH tunnel
  tunnelRuleId?: string        // Port forward rule ID for cleanup
}

// ── Tab management (multi-table) ──

export type SQLTabType = 'data' | 'query' | 'structure'

export interface SQLTab {
  id: string
  type: SQLTabType
  label: string
  table?: string               // For data/structure tabs
  schema?: string
  query?: string               // For query tabs
  isDirty?: boolean            // Has unsaved changes
}
```

**Step 2: Commit**

```bash
git add src/types/sql.ts
git commit -m "feat(sql): add type definitions for SQL client"
```

---

## Task 1.2: SQL Service (Backend)

**Files:**
- Create: `electron/services/SQLService.ts`

**Step 1: Create the service**

```typescript
// electron/services/SQLService.ts

import { EventEmitter } from 'events'

// ── Types (duplicated server-side to avoid cross-process imports) ──

export type DatabaseType = 'mysql' | 'postgres'

export interface DBConfig {
  type: DatabaseType
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl?: boolean
}

export interface DBQueryResult {
  fields: { name: string; type: string; table?: string }[]
  rows: Record<string, unknown>[]
  rowCount: number
  affectedRows?: number
  executionTimeMs: number
  truncated: boolean
  totalRowEstimate?: number
}

interface ActiveConnection {
  type: DatabaseType
  conn: any                    // mysql2 Connection or pg Client
  database: string
}

/**
 * SQLService manages database connections and query execution.
 * Each connection is keyed by a unique sessionId (separate from SSH connectionId).
 */
export class SQLService extends EventEmitter {
  private connections = new Map<string, ActiveConnection>()

  // ── Connect ──

  async connect(
    sqlSessionId: string,
    config: DBConfig
  ): Promise<{ success: boolean; error?: string }> {
    // Disconnect existing if any
    await this.disconnect(sqlSessionId).catch(() => {})

    try {
      if (config.type === 'mysql') {
        return await this.connectMySQL(sqlSessionId, config)
      } else if (config.type === 'postgres') {
        return await this.connectPostgres(sqlSessionId, config)
      }
      return { success: false, error: `Unsupported database type: ${config.type}` }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  }

  private async connectMySQL(
    sqlSessionId: string,
    config: DBConfig
  ): Promise<{ success: boolean; error?: string }> {
    const mysql = await import('mysql2/promise')
    const conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? {} : undefined,
      connectTimeout: 10000,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true
    })

    this.connections.set(sqlSessionId, {
      type: 'mysql',
      conn,
      database: config.database
    })

    return { success: true }
  }

  private async connectPostgres(
    sqlSessionId: string,
    config: DBConfig
  ): Promise<{ success: boolean; error?: string }> {
    const { Client } = await import('pg')
    const client = new Client({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10000
    })

    await client.connect()

    this.connections.set(sqlSessionId, {
      type: 'postgres',
      conn: client,
      database: config.database
    })

    return { success: true }
  }

  // ── Disconnect ──

  async disconnect(sqlSessionId: string): Promise<void> {
    const active = this.connections.get(sqlSessionId)
    if (!active) return

    try {
      if (active.type === 'mysql') {
        await active.conn.end()
      } else if (active.type === 'postgres') {
        await active.conn.end()
      }
    } catch {
      // Ignore disconnect errors
    } finally {
      this.connections.delete(sqlSessionId)
    }
  }

  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys())
    await Promise.allSettled(ids.map((id) => this.disconnect(id)))
  }

  isConnected(sqlSessionId: string): boolean {
    return this.connections.has(sqlSessionId)
  }

  // ── Execute Query ──

  async executeQuery(
    sqlSessionId: string,
    query: string,
    params?: unknown[]
  ): Promise<DBQueryResult> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected to database')

    const start = performance.now()

    try {
      if (active.type === 'mysql') {
        return await this.executeMySQLQuery(active, query, params, start)
      } else {
        return await this.executePostgresQuery(active, query, params, start)
      }
    } catch (err: any) {
      throw new Error(err.message || String(err))
    }
  }

  private async executeMySQLQuery(
    active: ActiveConnection,
    query: string,
    params: unknown[] | undefined,
    start: number
  ): Promise<DBQueryResult> {
    const [rows, fields] = await active.conn.execute(query, params)
    const elapsed = Math.round(performance.now() - start)

    // Handle non-SELECT queries (INSERT, UPDATE, DELETE)
    if (!Array.isArray(rows)) {
      return {
        fields: [],
        rows: [],
        rowCount: 0,
        affectedRows: (rows as any).affectedRows ?? 0,
        executionTimeMs: elapsed,
        truncated: false
      }
    }

    return {
      fields: (fields || []).map((f: any) => ({
        name: f.name,
        type: this.mysqlFieldType(f.columnType),
        table: f.table || undefined
      })),
      rows: rows as Record<string, unknown>[],
      rowCount: rows.length,
      executionTimeMs: elapsed,
      truncated: false
    }
  }

  private async executePostgresQuery(
    active: ActiveConnection,
    query: string,
    params: unknown[] | undefined,
    start: number
  ): Promise<DBQueryResult> {
    const result = await active.conn.query(query, params)
    const elapsed = Math.round(performance.now() - start)

    return {
      fields: (result.fields || []).map((f: any) => ({
        name: f.name,
        type: String(f.dataTypeID),
        table: f.tableID ? String(f.tableID) : undefined
      })),
      rows: result.rows || [],
      rowCount: result.rows?.length ?? 0,
      affectedRows: result.rowCount ?? undefined,
      executionTimeMs: elapsed,
      truncated: false
    }
  }

  // ── Schema Introspection ──

  async getDatabases(sqlSessionId: string): Promise<string[]> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected')

    if (active.type === 'mysql') {
      const result = await this.executeQuery(sqlSessionId, 'SHOW DATABASES')
      return result.rows.map((r: any) => r.Database || r.database)
    } else {
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname`
      )
      return result.rows.map((r: any) => r.datname)
    }
  }

  async switchDatabase(sqlSessionId: string, database: string): Promise<void> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected')

    if (active.type === 'mysql') {
      await active.conn.changeUser({ database })
      active.database = database
    } else {
      throw new Error('Postgres requires a new connection to switch databases')
    }
  }

  async getTables(
    sqlSessionId: string
  ): Promise<{ name: string; type: 'table' | 'view'; schema?: string; rowCount?: number }[]> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected')

    if (active.type === 'mysql') {
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT TABLE_NAME as table_name, TABLE_TYPE as table_type, TABLE_ROWS as row_count
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
         ORDER BY TABLE_NAME`
      )
      return result.rows.map((r: any) => ({
        name: r.table_name,
        type: r.table_type === 'VIEW' ? 'view' as const : 'table' as const,
        rowCount: r.row_count != null ? Number(r.row_count) : undefined
      }))
    } else {
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT t.tablename as table_name, 'table' as table_type, t.schemaname as schema_name,
                c.reltuples::bigint as row_count
         FROM pg_tables t
         JOIN pg_class c ON c.relname = t.tablename
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
         WHERE t.schemaname NOT IN ('pg_catalog', 'information_schema')
         UNION ALL
         SELECT v.viewname as table_name, 'view' as table_type, v.schemaname as schema_name, 0 as row_count
         FROM pg_views v
         WHERE v.schemaname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_name`
      )
      return result.rows.map((r: any) => ({
        name: r.table_name,
        type: r.table_type as 'table' | 'view',
        schema: r.schema_name,
        rowCount: r.row_count != null ? Number(r.row_count) : undefined
      }))
    }
  }

  async getColumns(
    sqlSessionId: string,
    table: string,
    schema?: string
  ): Promise<{
    name: string; type: string; nullable: boolean; defaultValue: string | null
    isPrimaryKey: boolean; isAutoIncrement: boolean; extra?: string; comment?: string
  }[]> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected')

    if (active.type === 'mysql') {
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT c.COLUMN_NAME as col_name, c.COLUMN_TYPE as col_type,
                c.IS_NULLABLE as nullable, c.COLUMN_DEFAULT as default_val,
                c.COLUMN_KEY as col_key, c.EXTRA as extra, c.COLUMN_COMMENT as comment
         FROM INFORMATION_SCHEMA.COLUMNS c
         WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME = ?
         ORDER BY c.ORDINAL_POSITION`,
        [table]
      )
      return result.rows.map((r: any) => ({
        name: r.col_name, type: r.col_type,
        nullable: r.nullable === 'YES', defaultValue: r.default_val,
        isPrimaryKey: r.col_key === 'PRI',
        isAutoIncrement: (r.extra || '').includes('auto_increment'),
        extra: r.extra || undefined, comment: r.comment || undefined
      }))
    } else {
      const schemaName = schema || 'public'
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT c.column_name as col_name,
                c.data_type || COALESCE('(' || c.character_maximum_length || ')', '') as col_type,
                c.is_nullable as nullable, c.column_default as default_val,
                CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_pk
         FROM information_schema.columns c
         LEFT JOIN (
           SELECT ku.column_name FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
           WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = $2
         ) pk ON pk.column_name = c.column_name
         WHERE c.table_name = $1 AND c.table_schema = $2
         ORDER BY c.ordinal_position`,
        [table, schemaName]
      )
      return result.rows.map((r: any) => ({
        name: r.col_name, type: r.col_type,
        nullable: r.nullable === 'YES', defaultValue: r.default_val,
        isPrimaryKey: Boolean(r.is_pk),
        isAutoIncrement: (r.default_val || '').includes('nextval')
      }))
    }
  }

  async getIndexes(sqlSessionId: string, table: string, schema?: string): Promise<{
    name: string; columns: string[]; isUnique: boolean; isPrimary: boolean; type: string
  }[]> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected')

    if (active.type === 'mysql') {
      const result = await this.executeQuery(sqlSessionId, `SHOW INDEX FROM \`${table}\``)
      const indexMap = new Map<string, any>()
      for (const row of result.rows as any[]) {
        const name = row.Key_name
        if (!indexMap.has(name)) {
          indexMap.set(name, {
            name, columns: [],
            isUnique: Number(row.Non_unique) === 0,
            isPrimary: name === 'PRIMARY',
            type: row.Index_type || 'BTREE'
          })
        }
        indexMap.get(name)!.columns.push(row.Column_name)
      }
      return Array.from(indexMap.values())
    } else {
      const schemaName = schema || 'public'
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT i.relname as index_name,
                array_agg(a.attname ORDER BY k.n) as columns,
                ix.indisunique as is_unique, ix.indisprimary as is_primary, am.amname as index_type
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_am am ON am.oid = i.relam
         CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n)
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
         WHERE t.relname = $1 AND n.nspname = $2
         GROUP BY i.relname, ix.indisunique, ix.indisprimary, am.amname
         ORDER BY i.relname`,
        [table, schemaName]
      )
      return result.rows.map((r: any) => ({
        name: r.index_name, columns: r.columns,
        isUnique: Boolean(r.is_unique), isPrimary: Boolean(r.is_primary),
        type: r.index_type || 'btree'
      }))
    }
  }

  async getForeignKeys(sqlSessionId: string, table: string, schema?: string): Promise<{
    name: string; columns: string[]; referencedTable: string
    referencedColumns: string[]; onUpdate: string; onDelete: string
  }[]> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected')

    if (active.type === 'mysql') {
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT kcu.CONSTRAINT_NAME as fk_name, kcu.COLUMN_NAME as col_name,
                kcu.REFERENCED_TABLE_NAME as ref_table, kcu.REFERENCED_COLUMN_NAME as ref_col,
                rc.UPDATE_RULE as on_update, rc.DELETE_RULE as on_delete
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
           ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.TABLE_NAME = kcu.TABLE_NAME
         WHERE kcu.TABLE_SCHEMA = DATABASE() AND kcu.TABLE_NAME = ?
           AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
        [table]
      )
      const fkMap = new Map<string, any>()
      for (const row of result.rows as any[]) {
        const name = row.fk_name
        if (!fkMap.has(name)) {
          fkMap.set(name, {
            name, columns: [], referencedTable: row.ref_table,
            referencedColumns: [], onUpdate: row.on_update, onDelete: row.on_delete
          })
        }
        fkMap.get(name)!.columns.push(row.col_name)
        fkMap.get(name)!.referencedColumns.push(row.ref_col)
      }
      return Array.from(fkMap.values())
    } else {
      const schemaName = schema || 'public'
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT tc.constraint_name as fk_name, kcu.column_name as col_name,
                ccu.table_name as ref_table, ccu.column_name as ref_col,
                rc.update_rule as on_update, rc.delete_rule as on_delete
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
         JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1 AND tc.table_schema = $2
         ORDER BY tc.constraint_name`,
        [table, schemaName]
      )
      const fkMap = new Map<string, any>()
      for (const row of result.rows as any[]) {
        const name = row.fk_name
        if (!fkMap.has(name)) {
          fkMap.set(name, {
            name, columns: [], referencedTable: row.ref_table,
            referencedColumns: [], onUpdate: row.on_update, onDelete: row.on_delete
          })
        }
        fkMap.get(name)!.columns.push(row.col_name)
        fkMap.get(name)!.referencedColumns.push(row.ref_col)
      }
      return Array.from(fkMap.values())
    }
  }

  // ── Utilities ──

  async getTableRowCount(sqlSessionId: string, table: string, schema?: string): Promise<number> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected')

    if (active.type === 'mysql') {
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT TABLE_ROWS as cnt FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
      )
      return Number((result.rows[0] as any)?.cnt ?? 0)
    } else {
      const schemaName = schema || 'public'
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT reltuples::bigint as cnt FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = $1 AND n.nspname = $2`,
        [table, schemaName]
      )
      return Number((result.rows[0] as any)?.cnt ?? 0)
    }
  }

  async getPrimaryKeyColumns(sqlSessionId: string, table: string, schema?: string): Promise<string[]> {
    const columns = await this.getColumns(sqlSessionId, table, schema)
    return columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
  }

  getCurrentDatabase(sqlSessionId: string): string | null {
    return this.connections.get(sqlSessionId)?.database ?? null
  }

  getConnectionType(sqlSessionId: string): DatabaseType | null {
    return this.connections.get(sqlSessionId)?.type ?? null
  }

  private mysqlFieldType(typeId: number): string {
    const types: Record<number, string> = {
      0: 'DECIMAL', 1: 'TINYINT', 2: 'SMALLINT', 3: 'INT',
      4: 'FLOAT', 5: 'DOUBLE', 6: 'NULL', 7: 'TIMESTAMP',
      8: 'BIGINT', 9: 'MEDIUMINT', 10: 'DATE', 11: 'TIME',
      12: 'DATETIME', 13: 'YEAR', 14: 'NEWDATE', 15: 'VARCHAR',
      16: 'BIT', 245: 'JSON', 246: 'DECIMAL', 247: 'ENUM',
      248: 'SET', 249: 'TINYBLOB', 250: 'MEDIUMBLOB',
      251: 'LONGBLOB', 252: 'BLOB', 253: 'VARCHAR',
      254: 'CHAR', 255: 'GEOMETRY'
    }
    return types[typeId] || `TYPE_${typeId}`
  }
}
```

**Step 2: Commit**

```bash
git add electron/services/SQLService.ts
git commit -m "feat(sql): add SQLService with MySQL and Postgres support"
```

---

## Task 1.3: SQL IPC Handlers

**Files:**
- Create: `electron/ipc/sql.ipc.ts`
- Modify: `electron/main.ts` (add registration)
- Modify: `electron/ipc/portforward.ipc.ts` (export getter)

**Step 1: Create the IPC module**

```typescript
// electron/ipc/sql.ipc.ts

import { ipcMain } from 'electron'
import { SQLService, DBConfig } from '../services/SQLService'
import { getSSHService } from './ssh.ipc'

const sqlService = new SQLService()

// Track SSH tunnel mappings: sqlSessionId -> { connectionId, ruleId, localPort }
const tunnelMap = new Map<string, { connectionId: string; ruleId: string; localPort: number }>()

export function registerSQLIPC(): void {
  // ── Connect (with optional SSH tunnel) ──
  ipcMain.handle(
    'sql:connect',
    async (_event, sqlSessionId: string, connectionId: string, config: {
      type: 'mysql' | 'postgres'; host: string; port: number
      username: string; password: string; database: string
      useSSHTunnel: boolean; ssl?: boolean
    }) => {
      try {
        let dbHost = config.host
        let dbPort = config.port

        if (config.useSSHTunnel && connectionId) {
          const sshService = getSSHService()
          const conn = sshService.get(connectionId)
          if (!conn) return { success: false, error: 'SSH connection not found' }

          // Find a free local port
          const net = await import('net')
          const localPort = await new Promise<number>((resolve, reject) => {
            const server = net.createServer()
            server.listen(0, '127.0.0.1', () => {
              const addr = server.address()
              const port = typeof addr === 'object' && addr ? addr.port : 0
              server.close(() => resolve(port))
            })
            server.on('error', reject)
          })

          const { getPortForwardService } = await import('./portforward.ipc')
          const ruleId = `sql-tunnel-${sqlSessionId}`

          const entry = await getPortForwardService().add(conn, {
            id: ruleId, type: 'local', name: `SQL: ${config.database}`,
            sourceHost: '127.0.0.1', sourcePort: localPort,
            destinationHost: config.host, destinationPort: config.port,
            autoStart: false, enabled: true
          })

          if (entry.status === 'error') {
            return { success: false, error: `SSH tunnel failed: ${entry.error}` }
          }

          tunnelMap.set(sqlSessionId, { connectionId, ruleId, localPort })
          dbHost = '127.0.0.1'
          dbPort = localPort
        }

        const result = await sqlService.connect(sqlSessionId, {
          type: config.type, host: dbHost, port: dbPort,
          user: config.username, password: config.password,
          database: config.database, ssl: config.ssl
        })

        if (result.success) {
          return { success: true, tunnelPort: tunnelMap.get(sqlSessionId)?.localPort }
        }

        if (tunnelMap.has(sqlSessionId)) await cleanupTunnel(sqlSessionId)
        return result
      } catch (err: any) {
        if (tunnelMap.has(sqlSessionId)) await cleanupTunnel(sqlSessionId)
        return { success: false, error: err.message || String(err) }
      }
    }
  )

  ipcMain.handle('sql:disconnect', async (_event, sqlSessionId: string) => {
    await sqlService.disconnect(sqlSessionId)
    await cleanupTunnel(sqlSessionId)
    return { success: true }
  })

  ipcMain.handle('sql:query', async (_event, sqlSessionId: string, query: string, params?: unknown[]) => {
    try {
      const result = await sqlService.executeQuery(sqlSessionId, query, params)
      return { success: true, data: result }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  ipcMain.handle('sql:getDatabases', async (_event, sqlSessionId: string) => {
    try { return { success: true, data: await sqlService.getDatabases(sqlSessionId) } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('sql:switchDatabase', async (_event, sqlSessionId: string, database: string) => {
    try { await sqlService.switchDatabase(sqlSessionId, database); return { success: true } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('sql:getTables', async (_event, sqlSessionId: string) => {
    try { return { success: true, data: await sqlService.getTables(sqlSessionId) } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('sql:getColumns', async (_event, sqlSessionId: string, table: string, schema?: string) => {
    try { return { success: true, data: await sqlService.getColumns(sqlSessionId, table, schema) } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('sql:getIndexes', async (_event, sqlSessionId: string, table: string, schema?: string) => {
    try { return { success: true, data: await sqlService.getIndexes(sqlSessionId, table, schema) } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('sql:getForeignKeys', async (_event, sqlSessionId: string, table: string, schema?: string) => {
    try { return { success: true, data: await sqlService.getForeignKeys(sqlSessionId, table, schema) } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('sql:getRowCount', async (_event, sqlSessionId: string, table: string, schema?: string) => {
    try { return { success: true, data: await sqlService.getTableRowCount(sqlSessionId, table, schema) } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('sql:getPrimaryKeys', async (_event, sqlSessionId: string, table: string, schema?: string) => {
    try { return { success: true, data: await sqlService.getPrimaryKeyColumns(sqlSessionId, table, schema) } }
    catch (err: any) { return { success: false, error: err.message } }
  })

  ipcMain.handle('sql:isConnected', (_event, sqlSessionId: string) => {
    return sqlService.isConnected(sqlSessionId)
  })
}

async function cleanupTunnel(sqlSessionId: string): Promise<void> {
  const tunnel = tunnelMap.get(sqlSessionId)
  if (!tunnel) return
  try {
    const { getPortForwardService } = await import('./portforward.ipc')
    getPortForwardService().remove(tunnel.connectionId, tunnel.ruleId)
  } catch { /* ignore */ }
  tunnelMap.delete(sqlSessionId)
}

export function getSQLService(): SQLService { return sqlService }
```

**Step 2: Register in `electron/main.ts`**

Add import: `import { registerSQLIPC } from './ipc/sql.ipc'`
Add call in `app.whenReady()`: `registerSQLIPC()`

**Step 3: Export `getPortForwardService` from `electron/ipc/portforward.ipc.ts`**

Add at the bottom of the file:
```typescript
export function getPortForwardService(): PortForwardService {
  return portForwardService
}
```

**Step 4: Commit**

```bash
git add electron/ipc/sql.ipc.ts electron/main.ts electron/ipc/portforward.ipc.ts
git commit -m "feat(sql): add SQL IPC handlers with SSH tunnel support"
```

---

## Task 1.4: Preload API Extension

**Files:**
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`

**Step 1: Add `sql` namespace to the preload API object in `electron/preload.ts`**

```typescript
sql: {
  connect: (sqlSessionId: string, connectionId: string, config: any) =>
    ipcRenderer.invoke('sql:connect', sqlSessionId, connectionId, config),
  disconnect: (sqlSessionId: string) =>
    ipcRenderer.invoke('sql:disconnect', sqlSessionId),
  query: (sqlSessionId: string, query: string, params?: unknown[]) =>
    ipcRenderer.invoke('sql:query', sqlSessionId, query, params),
  getDatabases: (sqlSessionId: string) =>
    ipcRenderer.invoke('sql:getDatabases', sqlSessionId),
  switchDatabase: (sqlSessionId: string, database: string) =>
    ipcRenderer.invoke('sql:switchDatabase', sqlSessionId, database),
  getTables: (sqlSessionId: string) =>
    ipcRenderer.invoke('sql:getTables', sqlSessionId),
  getColumns: (sqlSessionId: string, table: string, schema?: string) =>
    ipcRenderer.invoke('sql:getColumns', sqlSessionId, table, schema),
  getIndexes: (sqlSessionId: string, table: string, schema?: string) =>
    ipcRenderer.invoke('sql:getIndexes', sqlSessionId, table, schema),
  getForeignKeys: (sqlSessionId: string, table: string, schema?: string) =>
    ipcRenderer.invoke('sql:getForeignKeys', sqlSessionId, table, schema),
  getRowCount: (sqlSessionId: string, table: string, schema?: string) =>
    ipcRenderer.invoke('sql:getRowCount', sqlSessionId, table, schema),
  getPrimaryKeys: (sqlSessionId: string, table: string, schema?: string) =>
    ipcRenderer.invoke('sql:getPrimaryKeys', sqlSessionId, table, schema),
  isConnected: (sqlSessionId: string) =>
    ipcRenderer.invoke('sql:isConnected', sqlSessionId),
},
```

**Step 2: Update `src/env.d.ts`** with matching type declarations for `window.novadeck.sql`.

**Step 3: Commit**

```bash
git add electron/preload.ts src/env.d.ts
git commit -m "feat(sql): expose SQL API to renderer via preload"
```

---

## Task 1.5: SQL Zustand Store

**Files:**
- Create: `src/stores/sqlStore.ts`

**Step 1: Create the store** — see full implementation in the monolithic plan or implement following the pattern from `src/stores/connectionStore.ts`. Key state slices:

- **Connection**: status, config, currentDatabase, tunnelPort, error
- **Schema**: databases[], tables[], selectedTable, columns[], loading
- **Tabs**: SQLTab[], activeTabId
- **Data Grid**: queryResult, isLoading, pagination, sort
- **Filters**: TableFilter[]
- **Staged Changes**: StagedChange[]
- **Query Editor**: currentQuery, queryError
- **History**: QueryHistoryEntry[]
- **Actions**: setters for all above + `reset()` for full cleanup on disconnect

**Step 2: Commit**

```bash
git add src/stores/sqlStore.ts
git commit -m "feat(sql): add Zustand store for SQL client state"
```

---

## Task 1.6: Wire SQL Sub-Tab into ConnectionView

**Files:**
- Modify: `src/types/session.ts` — extend `activeSubTab` union type
- Modify: `src/components/ConnectionView.tsx` — add SQL tab
- Create: `src/components/sql/SQLView.tsx` — placeholder

**Step 1:** In `src/types/session.ts`, add `'sql'` to the `activeSubTab` union:
```typescript
activeSubTab: 'terminal' | 'sftp' | 'sql' | 'port-forwarding' | 'info' | 'log'
```

**Step 2:** In `src/components/ConnectionView.tsx`:
- Import `Database` from `lucide-react`
- Add `{ id: 'sql', label: 'SQL', icon: <Database size={13} /> }` to `SUB_TABS`
- Add lazy-mount block for SQL panel (same pattern as Terminal/SFTP):
```tsx
{mountedPanels.has('sql') && (
  <div className={cn('h-full', tab.activeSubTab !== 'sql' && 'hidden')}>
    <SQLView connectionId={tab.id} sessionId={tab.sessionId} />
  </div>
)}
```

**Step 3:** Create `src/components/sql/SQLView.tsx` with a placeholder showing a Database icon and "Connect to a database to get started" message.

**Step 4: Commit**

```bash
git add src/types/session.ts src/components/ConnectionView.tsx src/components/sql/SQLView.tsx
git commit -m "feat(sql): wire SQL sub-tab into ConnectionView"
```
