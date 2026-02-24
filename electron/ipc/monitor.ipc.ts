import { ipcMain, BrowserWindow } from 'electron'
import { MonitorService } from '../services/MonitorService'
import { getSSHService } from './ssh.ipc'

const monitorService = new MonitorService()

/**
 * Register server monitoring IPC handlers.
 *
 * Channels:
 *   monitor:start      → Start monitoring a connection
 *   monitor:stop       → Stop monitoring (keep history)
 *   monitor:getHistory → Get historical snapshots
 *   monitor:getLatest  → Get the latest snapshot
 *   monitor:getStatus  → Get current monitor status
 *
 * Events (main → renderer):
 *   monitor:data       → New snapshot data
 *   monitor:status     → Status change
 *   monitor:error      → Error message
 */
export function registerMonitorIPC(): void {
  ipcMain.handle('monitor:start', (event, connectionId: string) => {
    const sshService = getSSHService()
    const conn = sshService.get(connectionId)
    if (!conn) {
      return { success: false, error: 'Connection not found' }
    }
    if (conn.status !== 'connected') {
      return { success: false, error: 'Connection is not active' }
    }

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      return { success: false, error: 'Window not found' }
    }

    monitorService.startMonitoring(conn, win)
    return { success: true }
  })

  ipcMain.handle('monitor:stop', (_event, connectionId: string) => {
    monitorService.stopMonitoring(connectionId)
    return { success: true }
  })

  ipcMain.handle('monitor:getHistory', (_event, connectionId: string) => {
    return monitorService.getHistory(connectionId)
  })

  ipcMain.handle('monitor:getLatest', (_event, connectionId: string) => {
    return monitorService.getLatest(connectionId)
  })

  ipcMain.handle('monitor:getStatus', (_event, connectionId: string) => {
    return monitorService.getStatus(connectionId)
  })

  ipcMain.handle('monitor:killProcess', (_event, connectionId: string, pid: number, signal?: number) => {
    const sshService = getSSHService()
    const conn = sshService.get(connectionId)
    if (!conn || conn.status !== 'connected') {
      return { success: false, error: 'Not connected' }
    }
    return monitorService.killProcess(conn, pid, signal)
  })
}

/** Get the monitor service singleton */
export function getMonitorService(): MonitorService {
  return monitorService
}
