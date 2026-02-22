// electron/ipc/sql.ipc.ts

import { ipcMain } from 'electron'
import { Client as SSHClient } from 'ssh2'
import { readFileSync } from 'fs'
import { createServer, type Server } from 'net'
import { SQLService, DBConfig } from '../services/SQLService'
import { SQLConfigStore, StoredSQLConfig } from '../services/SQLConfigStore'
import { getSSHService } from './ssh.ipc'

const sqlService = new SQLService()
const sqlConfigStore = new SQLConfigStore()

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
