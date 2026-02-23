// electron/services/SQLService.ts

import { EventEmitter } from 'events'
import { Readable } from 'stream'

// ── Types (duplicated server-side to avoid cross-process imports) ──

export type DatabaseType = 'mysql' | 'postgres'

export type SSLMode = 'disabled' | 'preferred' | 'required' | 'verify-full'

export interface DBConfig {
  type: DatabaseType
  host: string
  port: number
  user: string
  password: string
  database?: string
  ssl?: boolean
  sslMode?: SSLMode
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
  ): Promise<{ success: boolean; error?: string; currentDatabase?: string }> {
    // Disconnect existing if any
    await this.disconnect(sqlSessionId).catch(() => {})

    try {
      let result: { success: boolean; error?: string }
      if (config.type === 'mysql') {
        result = await this.connectMySQL(sqlSessionId, config)
      } else if (config.type === 'postgres') {
        result = await this.connectPostgres(sqlSessionId, config)
      } else {
        return { success: false, error: `Unsupported database type: ${config.type}` }
      }

      if (result.success) {
        const currentDatabase = this.getCurrentDatabase(sqlSessionId) ?? undefined
        return { ...result, currentDatabase }
      }
      return result
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  }

  /** Resolve SSL options from sslMode or legacy ssl boolean */
  private resolveSSL(config: DBConfig): any {
    const mode = config.sslMode ?? (config.ssl ? 'preferred' : 'disabled')
    switch (mode) {
      case 'disabled': return undefined
      case 'preferred': return {}
      case 'required': return { rejectUnauthorized: false }
      case 'verify-full': return { rejectUnauthorized: true }
      default: return undefined
    }
  }

  private async connectMySQL(
    sqlSessionId: string,
    config: DBConfig
  ): Promise<{ success: boolean; error?: string }> {
    const mysql = await import('mysql2/promise')
    const dbName = config.database?.trim() || undefined
    const conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: dbName,
      ssl: this.resolveSSL(config),
      connectTimeout: 10000,
      supportBigNumbers: true,
      bigNumberStrings: true,
      dateStrings: true
    })

    // Discover current database if none specified
    let currentDb = dbName ?? ''
    if (!currentDb) {
      try {
        const [rows] = await conn.execute('SELECT DATABASE() as db')
        currentDb = (rows as any)?.[0]?.db ?? ''
      } catch { /* ignore */ }
    }

    this.connections.set(sqlSessionId, {
      type: 'mysql',
      conn,
      database: currentDb
    })

    return { success: true }
  }

  private async connectPostgres(
    sqlSessionId: string,
    config: DBConfig
  ): Promise<{ success: boolean; error?: string }> {
    const { Client } = await import('pg')
    const dbName = config.database?.trim() || undefined
    const sslOpts = this.resolveSSL(config)
    const client = new Client({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: dbName, // pg defaults to username if undefined
      ssl: sslOpts ? (sslOpts.rejectUnauthorized !== undefined ? sslOpts : { rejectUnauthorized: false }) : undefined,
      connectionTimeoutMillis: 10000
    })

    await client.connect()

    // Discover current database
    let currentDb = dbName ?? ''
    if (!currentDb) {
      try {
        const res = await client.query('SELECT current_database() as db')
        currentDb = res.rows?.[0]?.db ?? ''
      } catch { /* ignore */ }
    }

    this.connections.set(sqlSessionId, {
      type: 'postgres',
      conn: client,
      database: currentDb
    })

    return { success: true }
  }

  // ── Disconnect ──

  async disconnect(sqlSessionId: string): Promise<void> {
    const active = this.connections.get(sqlSessionId)
    if (!active) return

    const DISCONNECT_TIMEOUT_MS = 3000

    try {
      const endPromise =
        active.type === 'mysql' ? active.conn.end() : active.conn.end()
      await Promise.race([
        endPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Disconnect timed out')), DISCONNECT_TIMEOUT_MS)
        ),
      ])
    } catch {
      // Ignore disconnect errors (including timeout)
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
    ordinalPosition?: number; charset?: string | null; collation?: string | null
    columnKey?: string; identityGeneration?: string | null
    isGenerated?: boolean; generationExpression?: string | null
  }[]> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected')

    if (active.type === 'mysql') {
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT c.ORDINAL_POSITION as ordinal_pos,
                c.COLUMN_NAME as col_name, c.COLUMN_TYPE as col_type,
                c.IS_NULLABLE as nullable, c.COLUMN_DEFAULT as default_val,
                c.COLUMN_KEY as col_key, c.EXTRA as extra, c.COLUMN_COMMENT as comment,
                c.CHARACTER_SET_NAME as charset, c.COLLATION_NAME as collation,
                c.GENERATION_EXPRESSION as gen_expr
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
        extra: r.extra || undefined, comment: r.comment || undefined,
        ordinalPosition: Number(r.ordinal_pos),
        charset: r.charset || null,
        collation: r.collation || null,
        columnKey: r.col_key || '',
        identityGeneration: null,
        isGenerated: (r.extra || '').includes('GENERATED') || Boolean(r.gen_expr),
        generationExpression: r.gen_expr || null,
      }))
    } else {
      const schemaName = schema || 'public'
      const result = await this.executeQuery(
        sqlSessionId,
        `SELECT c.ordinal_position as ordinal_pos,
                c.column_name as col_name,
                CASE
                  WHEN c.data_type = 'character varying' THEN 'varchar(' || c.character_maximum_length || ')'
                  WHEN c.data_type = 'character' THEN 'char(' || c.character_maximum_length || ')'
                  WHEN c.data_type = 'numeric' AND c.numeric_precision IS NOT NULL
                    THEN 'numeric(' || c.numeric_precision || ',' || COALESCE(c.numeric_scale, 0) || ')'
                  WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
                  WHEN c.data_type = 'ARRAY' THEN c.udt_name
                  ELSE c.data_type
                END as col_type,
                c.is_nullable as nullable,
                c.column_default as default_val,
                c.is_identity as is_identity,
                c.identity_generation as identity_gen,
                c.is_generated as is_generated,
                c.generation_expression as gen_expr,
                c.collation_name as collation,
                CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_pk,
                CASE WHEN uq.column_name IS NOT NULL THEN 'UNI' ELSE '' END as col_key_extra,
                col_description(cl.oid, c.ordinal_position) as comment
         FROM information_schema.columns c
         JOIN pg_catalog.pg_class cl ON cl.relname = c.table_name
         JOIN pg_catalog.pg_namespace ns ON ns.oid = cl.relnamespace AND ns.nspname = c.table_schema
         LEFT JOIN (
           SELECT ku.column_name FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
             AND tc.table_schema = ku.table_schema
           WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND tc.table_schema = $2
         ) pk ON pk.column_name = c.column_name
         LEFT JOIN (
           SELECT ku.column_name FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
             AND tc.table_schema = ku.table_schema
           WHERE tc.constraint_type = 'UNIQUE' AND tc.table_name = $1 AND tc.table_schema = $2
         ) uq ON uq.column_name = c.column_name
         WHERE c.table_name = $1 AND c.table_schema = $2
         ORDER BY c.ordinal_position`,
        [table, schemaName]
      )
      return result.rows.map((r: any) => {
        const isPk = Boolean(r.is_pk)
        const isSerial = (r.default_val || '').includes('nextval')
        let columnKey = ''
        if (isPk) columnKey = 'PRI'
        else if (r.col_key_extra === 'UNI') columnKey = 'UNI'

        return {
          name: r.col_name,
          type: r.col_type,
          nullable: r.nullable === 'YES',
          defaultValue: r.default_val,
          isPrimaryKey: isPk,
          isAutoIncrement: isSerial || r.is_identity === 'YES',
          extra: isSerial ? 'serial' : (r.identity_gen ? `identity(${r.identity_gen})` : undefined),
          comment: r.comment || undefined,
          ordinalPosition: Number(r.ordinal_pos),
          charset: null,
          collation: r.collation || null,
          columnKey,
          identityGeneration: r.identity_gen || null,
          isGenerated: r.is_generated === 'ALWAYS',
          generationExpression: r.gen_expr || null,
        }
      })
    }
  }

  async getIndexes(sqlSessionId: string, table: string, schema?: string): Promise<{
    name: string; columns: string[]; isUnique: boolean; isPrimary: boolean; type: string
  }[]> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected')

    if (active.type === 'mysql') {
      const escaped = table.replace(/`/g, '``')
      const result = await this.executeQuery(sqlSessionId, `SHOW INDEX FROM \`${escaped}\``)
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

  // ── Streaming ──

  /**
   * Execute a query and return results as a Readable stream of row objects.
   * Used for exporting large tables without loading all rows into memory.
   * MySQL: uses mysql2's .stream() on the underlying (non-promise) connection
   * PostgreSQL: uses pg-query-stream
   */
  async streamQuery(sqlSessionId: string, query: string): Promise<Readable> {
    const active = this.connections.get(sqlSessionId)
    if (!active) throw new Error('Not connected to database')

    if (active.type === 'mysql') {
      // The promise wrapper stores the raw connection at .connection
      // The raw connection's .query() returns a Query object with .stream()
      const rawConn = active.conn.connection
      return rawConn.query(query).stream()
    } else {
      // PostgreSQL: use pg-query-stream
      const QueryStream = (await import('pg-query-stream')).default
      const qs = new QueryStream(query, undefined, { batchSize: 500 })
      const stream: Readable = active.conn.query(qs)
      return stream
    }
  }

  /**
   * Get the raw connection for a session (used by transfer service for streaming).
   */
  getConnection(sqlSessionId: string): { type: DatabaseType; conn: any; database: string } | undefined {
    return this.connections.get(sqlSessionId)
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
