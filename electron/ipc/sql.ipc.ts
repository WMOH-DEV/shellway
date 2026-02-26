// electron/ipc/sql.ipc.ts

import { ipcMain, BrowserWindow } from 'electron'
import { Client as SSHClient } from 'ssh2'
import { readFileSync } from 'fs'
import { access, constants as fsConstants } from 'fs/promises'
import { createServer, type Server } from 'net'
import { SQLService, DBConfig } from '../services/SQLService'
import { SQLConfigStore, StoredSQLConfig } from '../services/SQLConfigStore'
import { SQLDataTransferService, ExportOptions, ImportSQLOptions, ImportCSVOptions, BackupOptions, RestoreOptions } from '../services/SQLDataTransferService'
import { getSSHService } from './ssh.ipc'

const sqlService = new SQLService()
const sqlConfigStore = new SQLConfigStore()
const transferService = new SQLDataTransferService(sqlService)

// Forward progress events from the transfer service to all renderer windows
transferService.on('progress', (sqlSessionId: string, progress: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sql:transfer:progress', sqlSessionId, progress)
  }
})

// Forward query-executed events from SQLService to all renderer windows
// This captures ALL queries: direct sql:query, getColumns, getIndexes, getForeignKeys, etc.
sqlService.on('query-executed', (sqlSessionId: string, info: {
  query: string; params?: unknown[]; executionTimeMs: number; rowCount?: number; error?: string
}) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sql:query-executed', sqlSessionId, info)
  }
})

// Forward query lifecycle events for the running queries monitor
sqlService.on('query-started', (queryId: string, sqlSessionId: string, query: string) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sql:query-started', queryId, sqlSessionId, query)
  }
})

sqlService.on('query-completed', (queryId: string, sqlSessionId: string) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sql:query-completed', queryId, sqlSessionId)
  }
})

/** Get the SQLConfigStore singleton (for use by other services) */
export function getSQLConfigStore(): SQLConfigStore {
  return sqlConfigStore
}

// Track SSH tunnel mappings: sqlSessionId -> { connectionId, ruleId, localPort }
const tunnelMap = new Map<string, { connectionId: string; ruleId: string; localPort: number }>()

// Track ephemeral SSH connections for standalone DB tunnels
const ephemeralSSH = new Map<string, { client: SSHClient; server: Server; localPort: number }>()

/** SSH tunnel configuration for standalone (non-SSH-session) database connections */
interface SSHTunnelConfig {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privatekey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

export function registerSQLIPC(): void {
  // ── Connect (with optional SSH tunnel) ──
  // Supports three modes:
  //   1. Direct connection (useSSHTunnel=false): connects to DB host:port directly
  //   2. SSH session tunnel (useSSHTunnel=true, no sshConfig): uses existing SSH session via connectionId
  //   3. Standalone SSH tunnel (useSSHTunnel=true, sshConfig provided): creates ephemeral SSH connection
  ipcMain.handle(
    'sql:connect',
    async (_event, sqlSessionId: string, connectionId: string, config: {
      type: 'mysql' | 'postgres'; host: string; port: number
      username: string; password: string; database?: string
      useSSHTunnel: boolean; ssl?: boolean; sslMode?: string
      sshConfig?: SSHTunnelConfig
    }) => {
      // ── Input validation ──
      if (!sqlSessionId || typeof sqlSessionId !== 'string') {
        return { success: false, error: 'Invalid session ID' }
      }
      if (!config || typeof config !== 'object') {
        return { success: false, error: 'Invalid configuration' }
      }
      if (!config.host || typeof config.host !== 'string') {
        return { success: false, error: 'Invalid host' }
      }
      if (!config.type || !['mysql', 'postgres'].includes(config.type)) {
        return { success: false, error: 'Invalid database type — must be mysql or postgres' }
      }
      const validatedPort = Number(config.port)
      if (!Number.isFinite(validatedPort) || validatedPort < 1 || validatedPort > 65535) {
        return { success: false, error: 'Invalid port — must be between 1 and 65535' }
      }
      config.port = validatedPort

      try {
        let dbHost = config.host
        let dbPort = config.port

        if (config.useSSHTunnel) {
          if (config.sshConfig) {
            // ── Mode 3: Standalone ephemeral SSH tunnel ──
            const ssh = config.sshConfig
            const localPort = await createEphemeralTunnel(
              sqlSessionId, ssh, config.host, config.port
            )
            dbHost = '127.0.0.1'
            dbPort = localPort
          } else if (connectionId) {
            // ── Mode 2: Tunnel through existing SSH session ──
            const sshService = getSSHService()
            const conn = sshService.get(connectionId)
            if (!conn) return { success: false, error: 'SSH connection not found' }

            const localPort = await findFreePort()

            const { getPortForwardService } = await import('./portforward.ipc')
            const ruleId = `sql-tunnel-${sqlSessionId}`

            const entry = await getPortForwardService().add(conn, {
              id: ruleId, type: 'local', name: `SQL: ${config.database || 'server'}`,
              sourceHost: '127.0.0.1', sourcePort: localPort,
              destinationHost: config.host, destinationPort: config.port
            })

            if (entry.status === 'error') {
              return { success: false, error: `SSH tunnel failed: ${entry.error}` }
            }

            tunnelMap.set(sqlSessionId, { connectionId, ruleId, localPort })
            dbHost = '127.0.0.1'
            dbPort = localPort
          } else {
            return { success: false, error: 'SSH tunnel requested but no SSH configuration provided' }
          }
        }

        const result = await sqlService.connect(sqlSessionId, {
          type: config.type, host: dbHost, port: dbPort,
          user: config.username, password: config.password,
          database: config.database || undefined,
          ssl: config.ssl,
          sslMode: config.sslMode as any,
        })

        if (result.success) {
          return {
            success: true,
            tunnelPort: tunnelMap.get(sqlSessionId)?.localPort || ephemeralSSH.get(sqlSessionId)?.localPort,
            currentDatabase: result.currentDatabase,
          }
        }

        // Cleanup on failure
        if (tunnelMap.has(sqlSessionId)) await cleanupTunnel(sqlSessionId)
        if (ephemeralSSH.has(sqlSessionId)) cleanupEphemeralSSH(sqlSessionId)
        return result
      } catch (err: any) {
        if (tunnelMap.has(sqlSessionId)) await cleanupTunnel(sqlSessionId)
        if (ephemeralSSH.has(sqlSessionId)) cleanupEphemeralSSH(sqlSessionId)
        return { success: false, error: err.message || String(err) }
      }
    }
  )

  ipcMain.handle('sql:disconnect', async (_event, sqlSessionId: string) => {
    await sqlService.disconnect(sqlSessionId)
    await cleanupTunnel(sqlSessionId)
    cleanupEphemeralSSH(sqlSessionId)
    return { success: true }
  })

  ipcMain.handle('sql:query', async (_event, sqlSessionId: string, query: string, params?: unknown[], queryId?: string) => {
    try {
      const result = await sqlService.executeQuery(sqlSessionId, query, params, queryId)
      return { success: true, data: result }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Cancel a running query ──
  ipcMain.handle('sql:cancelQuery', async (_event, queryId: string) => {
    if (!queryId || typeof queryId !== 'string') {
      return { success: false, error: 'Invalid query ID' }
    }
    return sqlService.cancelQuery(queryId)
  })

  // ── Cancel all running queries for a session ──
  ipcMain.handle('sql:cancelAllQueries', async (_event, sqlSessionId: string) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }
    await sqlService.cancelAllSessionQueries(sqlSessionId)
    return { success: true }
  })

  // ── Get running queries ──
  ipcMain.handle('sql:getRunningQueries', (_event, sqlSessionId?: string) => {
    return sqlService.getRunningQueries(sqlSessionId)
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

  // Combined structure query — single roundtrip over SSH tunnel
  ipcMain.handle('sql:getTableStructure', async (_event, sqlSessionId: string, table: string, schema?: string) => {
    try { return { success: true, data: await sqlService.getTableStructure(sqlSessionId, table, schema) } }
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

  // ── Saved SQL configs (persist credentials per SSH session) ──

  ipcMain.handle('sql:config:get', (_event, sessionId: string) => {
    try {
      const config = sqlConfigStore.get(sessionId)
      return { success: true, data: config }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sql:config:save', (_event, config: StoredSQLConfig) => {
    try {
      sqlConfigStore.save(config)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sql:config:delete', (_event, sessionId: string) => {
    try {
      sqlConfigStore.delete(sessionId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('sql:config:getStandalone', () => {
    try {
      const configs = sqlConfigStore.getStandalone()
      return { success: true, data: configs }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // ── Data Transfer: Export ──

  ipcMain.handle('sql:export', async (_event, sqlSessionId: string, filePath: string, options: unknown) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }
    if (!options || typeof options !== 'object') {
      return { success: false, error: 'Invalid export options' }
    }

    const opts = options as ExportOptions & { scope?: 'table' | 'database'; table?: string }

    try {
      if (opts.scope === 'table' && opts.table) {
        const result = await transferService.exportTable(sqlSessionId, opts.table, filePath, opts)
        return { success: true, operationId: result.operationId }
      } else {
        const result = await transferService.exportDatabase(sqlSessionId, filePath, opts)
        return { success: true, operationId: result.operationId }
      }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Data Transfer: Import SQL ──

  ipcMain.handle('sql:import:sql', async (_event, sqlSessionId: string, filePath: string, options: unknown) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }
    if (!options || typeof options !== 'object') {
      return { success: false, error: 'Invalid import options' }
    }

    try {
      await access(filePath, fsConstants.R_OK)
    } catch {
      return { success: false, error: 'File not found or not readable' }
    }

    try {
      const result = await transferService.importSQL(sqlSessionId, filePath, options as ImportSQLOptions)
      return { success: true, operationId: result.operationId }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Data Transfer: Pre-scan SQL file ──

  ipcMain.handle('sql:import:sql-prescan', async (_event, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }

    try {
      await access(filePath, fsConstants.R_OK)
    } catch {
      return { success: false, error: 'File not found or not readable' }
    }

    try {
      const data = await transferService.preScanSQL(filePath)
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Data Transfer: Import CSV ──

  ipcMain.handle('sql:import:csv', async (_event, sqlSessionId: string, filePath: string, options: unknown) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }
    if (!options || typeof options !== 'object') {
      return { success: false, error: 'Invalid import options' }
    }

    try {
      await access(filePath, fsConstants.R_OK)
    } catch {
      return { success: false, error: 'File not found or not readable' }
    }

    try {
      const result = await transferService.importCSV(sqlSessionId, filePath, options as ImportCSVOptions)
      return { success: true, operationId: result.operationId }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Data Transfer: Preview CSV ──

  ipcMain.handle('sql:import:csv-preview', async (_event, filePath: string) => {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }

    try {
      await access(filePath, fsConstants.R_OK)
    } catch {
      return { success: false, error: 'File not found or not readable' }
    }

    try {
      const data = await transferService.previewCSV(filePath)
      return { success: true, data }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Backup via SSH ──

  ipcMain.handle('sql:backup', async (_event, sqlSessionId: string, database: string, filePath: string, options: unknown) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }
    if (!database || typeof database !== 'string') {
      return { success: false, error: 'Invalid database name' }
    }
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }

    const sshClient = getSSHClientForSession(sqlSessionId)
    if (!sshClient) {
      return { success: false, error: 'Backup requires an SSH connection. Direct database connections do not support server-side backup.' }
    }

    const connInfo = sqlService.getConnection(sqlSessionId)
    if (!connInfo) {
      return { success: false, error: 'Database session not found' }
    }

    // For SSH tunnels, the DB binary runs on the remote SSH host.
    // Default to localhost:defaultPort — the caller overrides via options if needed.
    const dbConfig = {
      host: '127.0.0.1',
      port: connInfo.type === 'mysql' ? 3306 : 5432,
      user: '', // Will need to be provided in options or from stored config
      password: '',
    }

    // The caller should provide the DB credentials in options since we can't recover them
    // from the active connection (passwords aren't stored after connect)
    const opts = (options || {}) as BackupOptions & { dbHost?: string; dbPort?: number; dbUser?: string; dbPassword?: string }
    if (opts.dbHost) dbConfig.host = opts.dbHost
    if (opts.dbPort) dbConfig.port = opts.dbPort
    if (opts.dbUser) dbConfig.user = opts.dbUser
    if (opts.dbPassword !== undefined) dbConfig.password = opts.dbPassword

    if (!dbConfig.user) {
      return { success: false, error: 'Database username is required for backup (provide dbUser in options)' }
    }

    try {
      const result = await transferService.backupViaSSH(
        sshClient, database, connInfo.type, dbConfig, filePath, opts
      )
      return { success: true, operationId: result.operationId }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Restore via SSH ──

  ipcMain.handle('sql:restore', async (_event, sqlSessionId: string, database: string, filePath: string, options: unknown) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }
    if (!database || typeof database !== 'string') {
      return { success: false, error: 'Invalid database name' }
    }
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' }
    }

    try {
      await access(filePath, fsConstants.R_OK)
    } catch {
      return { success: false, error: 'File not found or not readable' }
    }

    const sshClient = getSSHClientForSession(sqlSessionId)
    if (!sshClient) {
      return { success: false, error: 'Restore requires an SSH connection. Direct database connections do not support server-side restore.' }
    }

    const connInfo = sqlService.getConnection(sqlSessionId)
    if (!connInfo) {
      return { success: false, error: 'Database session not found' }
    }

    const dbConfig = {
      host: '127.0.0.1',
      port: connInfo.type === 'mysql' ? 3306 : 5432,
      user: '',
      password: '',
    }

    const opts = (options || {}) as RestoreOptions & { dbHost?: string; dbPort?: number; dbUser?: string; dbPassword?: string }
    if (opts.dbHost) dbConfig.host = opts.dbHost
    if (opts.dbPort) dbConfig.port = opts.dbPort
    if (opts.dbUser) dbConfig.user = opts.dbUser
    if (opts.dbPassword !== undefined) dbConfig.password = opts.dbPassword

    if (!dbConfig.user) {
      return { success: false, error: 'Database username is required for restore (provide dbUser in options)' }
    }

    try {
      const result = await transferService.restoreViaSSH(
        sshClient, filePath, database, connInfo.type, dbConfig, opts
      )
      return { success: true, operationId: result.operationId }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Create Database ──

  ipcMain.handle('sql:createDatabase', async (_event, sqlSessionId: string, options: unknown) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }
    if (!options || typeof options !== 'object') {
      return { success: false, error: 'Invalid options' }
    }

    const opts = options as { name?: string; charset?: string; collation?: string; encoding?: string; template?: string }
    if (!opts.name || typeof opts.name !== 'string') {
      return { success: false, error: 'Database name is required' }
    }

    try {
      return await transferService.createDatabase(sqlSessionId, opts as { name: string; charset?: string; collation?: string; encoding?: string; template?: string })
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Get Charsets ──

  ipcMain.handle('sql:getCharsets', async (_event, sqlSessionId: string) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }

    const dbType = sqlService.getConnectionType(sqlSessionId)
    if (!dbType) {
      return { success: false, error: 'Not connected' }
    }

    try {
      if (dbType === 'mysql') {
        const result = await sqlService.executeQuery(sqlSessionId, 'SHOW CHARACTER SET')
        const charsets = result.rows.map((row: Record<string, unknown>) => ({
          name: row['Charset'] as string,
          defaultCollation: row['Default collation'] as string,
        }))
        return { success: true, data: charsets }
      } else {
        const result = await sqlService.executeQuery(
          sqlSessionId,
          `SELECT pg_encoding_to_char(encid) AS name
           FROM (SELECT generate_series(0, 41) AS encid) s
           WHERE pg_encoding_to_char(encid) <> ''
           ORDER BY name`
        )
        const encodings = result.rows.map((row: Record<string, unknown>) => ({
          name: row['name'] as string,
        }))
        return { success: true, data: encodings }
      }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Get Collations ──

  ipcMain.handle('sql:getCollations', async (_event, sqlSessionId: string, charset: string) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }

    const dbType = sqlService.getConnectionType(sqlSessionId)
    if (!dbType) {
      return { success: false, error: 'Not connected' }
    }

    try {
      if (dbType === 'mysql') {
        if (!charset || typeof charset !== 'string') {
          return { success: false, error: 'Charset is required' }
        }
        const result = await sqlService.executeQuery(
          sqlSessionId,
          'SHOW COLLATION WHERE Charset = ?',
          [charset]
        )
        const collations = result.rows.map((row: Record<string, unknown>) =>
          row['Collation'] as string
        )
        return { success: true, data: collations }
      } else {
        const result = await sqlService.executeQuery(
          sqlSessionId,
          `SELECT collname FROM pg_collation ORDER BY collname`
        )
        const collations = result.rows.map((row: Record<string, unknown>) =>
          row['collname'] as string
        )
        return { success: true, data: collations }
      }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Execute Structure Changes (ALTER TABLE) ──
  // Accepts an array of SQL statements to execute sequentially (e.g. ALTER TABLE, COMMENT ON, etc.)
  ipcMain.handle('sql:executeStatements', async (_event, sqlSessionId: string, statements: string[]) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }
    if (!Array.isArray(statements) || statements.length === 0) {
      return { success: false, error: 'No statements provided' }
    }

    // Validate each statement is a string
    for (const stmt of statements) {
      if (typeof stmt !== 'string' || !stmt.trim()) {
        return { success: false, error: 'Invalid SQL statement in batch' }
      }
    }

    try {
      const results: { statement: string; success: boolean; error?: string }[] = []
      for (const stmt of statements) {
        try {
          await sqlService.executeQuery(sqlSessionId, stmt)
          results.push({ statement: stmt, success: true })
        } catch (err: any) {
          results.push({ statement: stmt, success: false, error: err.message || String(err) })
          // Stop on first error — don't execute remaining statements
          return {
            success: false,
            error: `Failed at statement: ${err.message || String(err)}`,
            results,
            failedStatement: stmt,
          }
        }
      }
      return { success: true, results }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Generate DDL ──

  ipcMain.handle('sql:generateDDL', async (_event, sqlSessionId: string, table: string, schema?: string) => {
    if (!sqlSessionId || typeof sqlSessionId !== 'string') {
      return { success: false, error: 'Invalid session ID' }
    }
    if (!table || typeof table !== 'string') {
      return { success: false, error: 'Invalid table name' }
    }

    try {
      const ddl = await transferService.generateCreateTable(sqlSessionId, table, schema)
      return { success: true, data: ddl }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // ── Cancel Transfer ──

  ipcMain.handle('sql:transfer:cancel', async (_event, operationId: string) => {
    if (!operationId || typeof operationId !== 'string') {
      return { success: false, error: 'Invalid operation ID' }
    }

    try {
      transferService.cancel(operationId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })
}

// ── Helper: find a free local port ──

async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

// ── Helper: create an ephemeral SSH tunnel (for standalone DB connections) ──
// Binds the TCP forwarder to port 0 to avoid TOCTOU races with findFreePort.

async function createEphemeralTunnel(
  sqlSessionId: string,
  sshConfig: SSHTunnelConfig,
  dbHost: string,
  dbPort: number,
): Promise<number> {
  // Validate inputs
  if (sshConfig.authMethod === 'privatekey') {
    if (!sshConfig.privateKeyPath) {
      throw new Error('Private key file path is required for key-based SSH authentication')
    }
    const { existsSync } = await import('fs')
    if (!existsSync(sshConfig.privateKeyPath)) {
      throw new Error(`Private key file not found: ${sshConfig.privateKeyPath}`)
    }
  }

  return new Promise<number>((resolve, reject) => {
    let settled = false
    const client = new SSHClient()

    // Build ssh2 ConnectConfig
    const connectConfig: Record<string, unknown> = {
      host: sshConfig.host,
      port: sshConfig.port || 22,
      username: sshConfig.username,
      readyTimeout: 30000,
    }

    if (sshConfig.authMethod === 'privatekey') {
      try {
        connectConfig.privateKey = readFileSync(sshConfig.privateKeyPath!)
      } catch (err: any) {
        reject(new Error(`Failed to read private key: ${err.message}`))
        return
      }
      if (sshConfig.passphrase) {
        connectConfig.passphrase = sshConfig.passphrase
      }
    } else if (sshConfig.authMethod === 'password') {
      connectConfig.password = sshConfig.password || ''
    }

    // Create a local TCP server that forwards connections through SSH.
    // Bind to port 0 — the OS assigns a free port atomically, no TOCTOU race.
    const tcpServer = createServer((socket) => {
      socket.on('error', () => socket.destroy())
      client.forwardOut(
        '127.0.0.1', 0,
        dbHost, dbPort,
        (err, stream) => {
          if (err) {
            socket.destroy()
            return
          }
          stream.on('error', () => stream.destroy())
          socket.pipe(stream).pipe(socket)
          stream.on('close', () => socket.destroy())
          socket.on('close', () => stream.destroy())
        }
      )
    })

    tcpServer.on('error', (err) => {
      if (!settled) {
        settled = true
        client.end()
        reject(new Error(`TCP tunnel server failed: ${err.message}`))
      }
    })

    client.on('ready', () => {
      // Bind to port 0 — OS assigns a free port atomically
      tcpServer.listen(0, '127.0.0.1', () => {
        const addr = tcpServer.address()
        const localPort = typeof addr === 'object' && addr ? addr.port : 0
        if (!localPort) {
          settled = true
          tcpServer.close()
          client.end()
          reject(new Error('Failed to allocate local port for SSH tunnel'))
          return
        }
        settled = true
        ephemeralSSH.set(sqlSessionId, { client, server: tcpServer, localPort })
        resolve(localPort)
      })
    })

    client.on('error', (err) => {
      if (!settled) {
        settled = true
        tcpServer.close()
        reject(new Error(`SSH connection failed: ${err.message}`))
      }
    })

    // Handle SSH connection drop — cleanup TCP server
    client.on('close', () => {
      tcpServer.close()
      ephemeralSSH.delete(sqlSessionId)
    })

    client.connect(connectConfig as any)
  })
}

// ── Helper: cleanup SSH session tunnel (through existing SSH service) ──

async function cleanupTunnel(sqlSessionId: string): Promise<void> {
  const tunnel = tunnelMap.get(sqlSessionId)
  if (!tunnel) return
  try {
    const { getPortForwardService } = await import('./portforward.ipc')
    getPortForwardService().remove(tunnel.connectionId, tunnel.ruleId)
  } catch { /* ignore */ }
  tunnelMap.delete(sqlSessionId)
}

// ── Helper: cleanup ephemeral SSH connection (standalone tunnels) ──

function cleanupEphemeralSSH(sqlSessionId: string): void {
  const entry = ephemeralSSH.get(sqlSessionId)
  if (!entry) return
  try { entry.server.close() } catch { /* ignore */ }
  try { entry.client.end() } catch { /* ignore */ }
  ephemeralSSH.delete(sqlSessionId)
}

export function getSQLService(): SQLService { return sqlService }

/** Get the transfer service singleton (for use by other modules) */
export function getTransferService(): SQLDataTransferService { return transferService }

/**
 * Resolve the SSH client for a given SQL session.
 * - Mode 3 (ephemeral SSH): check ephemeralSSH map
 * - Mode 2 (SSH session tunnel): resolve via tunnelMap → SSHService
 * - Mode 1 (direct): returns null
 */
export function getSSHClientForSession(sqlSessionId: string): SSHClient | null {
  // Mode 3: Ephemeral SSH connection
  const ephemeral = ephemeralSSH.get(sqlSessionId)
  if (ephemeral) return ephemeral.client

  // Mode 2: Tunnel through existing SSH session
  const tunnel = tunnelMap.get(sqlSessionId)
  if (tunnel) {
    const sshService = getSSHService()
    const conn = sshService.get(tunnel.connectionId)
    if (conn) return conn._client
  }

  // Mode 1: Direct connection (no SSH)
  return null
}
