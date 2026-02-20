// electron/ipc/sql.ipc.ts

import { ipcMain } from 'electron'
import { SQLService, DBConfig } from '../services/SQLService'
import { SQLConfigStore, StoredSQLConfig } from '../services/SQLConfigStore'
import { getSSHService } from './ssh.ipc'

const sqlService = new SQLService()
const sqlConfigStore = new SQLConfigStore()

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
            destinationHost: config.host, destinationPort: config.port
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
