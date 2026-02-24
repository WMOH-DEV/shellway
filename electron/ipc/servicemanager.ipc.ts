import { ipcMain } from 'electron'
import { ServiceManagerService } from '../services/ServiceManagerService'
import { getSSHService } from './ssh.ipc'
import type { ServiceAction } from '../../src/types/serviceManager'

const serviceManagerService = new ServiceManagerService()

/** Valid service actions for IPC boundary validation */
const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'start', 'stop', 'restart', 'reload', 'enable', 'disable', 'mask', 'unmask'
])

/**
 * Register service manager IPC handlers.
 *
 * Channels:
 *   services:probe   → Check if systemd is available on the remote server
 *   services:list    → List all systemd services
 *   services:details → Get detailed info about a specific service
 *   services:action  → Perform a systemctl action (start, stop, restart, etc.)
 *   services:logs    → Retrieve journal logs for a service
 */
export function registerServiceManagerIPC(): void {
  ipcMain.handle('services:probe', (_event, connectionId: string) => {
    if (typeof connectionId !== 'string') return { success: false, error: 'Invalid connectionId' }
    const conn = getSSHService().get(connectionId)
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Not connected' }
    }
    return serviceManagerService.probe(conn)
  })

  ipcMain.handle('services:list', (_event, connectionId: string) => {
    if (typeof connectionId !== 'string') return { success: false, error: 'Invalid connectionId' }
    const conn = getSSHService().get(connectionId)
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Not connected' }
    }
    return serviceManagerService.listServices(conn)
  })

  ipcMain.handle('services:details', (_event, connectionId: string, unit: string) => {
    if (typeof connectionId !== 'string') return { success: false, error: 'Invalid connectionId' }
    if (typeof unit !== 'string') return { success: false, error: 'Invalid unit name' }
    const conn = getSSHService().get(connectionId)
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Not connected' }
    }
    return serviceManagerService.getServiceDetails(conn, unit)
  })

  ipcMain.handle('services:action', (_event, connectionId: string, unit: string, action: string) => {
    if (typeof connectionId !== 'string') return { success: false, error: 'Invalid connectionId' }
    if (typeof unit !== 'string') return { success: false, error: 'Invalid unit name' }
    if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
      return { success: false, error: 'Invalid action' }
    }
    const conn = getSSHService().get(connectionId)
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Not connected' }
    }
    return serviceManagerService.performAction(conn, unit, action as ServiceAction)
  })

  ipcMain.handle('services:logs', (_event, connectionId: string, unit: string, lines?: number, since?: string) => {
    if (typeof connectionId !== 'string') return { success: false, error: 'Invalid connectionId' }
    if (typeof unit !== 'string') return { success: false, error: 'Invalid unit name' }
    if (lines !== undefined && (typeof lines !== 'number' || !Number.isInteger(lines))) {
      return { success: false, error: 'Invalid lines parameter' }
    }
    if (since !== undefined && typeof since !== 'string') {
      return { success: false, error: 'Invalid since parameter' }
    }
    const conn = getSSHService().get(connectionId)
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Not connected' }
    }
    return serviceManagerService.getLogs(conn, unit, lines, since)
  })
}

/** Get the service manager service singleton */
export function getServiceManagerService(): ServiceManagerService {
  return serviceManagerService
}
