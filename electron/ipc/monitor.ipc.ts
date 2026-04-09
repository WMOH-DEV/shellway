import { ipcMain } from 'electron'
import { MonitorService } from '../services/MonitorService'
import { getSSHService } from './ssh.ipc'
import { windowManager } from '../services/WindowManager'

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

    // Auto-subscribe the initiating window so monitor:data events reach it.
    // ssh:connect already subscribed the window for ssh:* events; this adds
    // the monitor namespace on top.
    const windowId = windowManager.getWindowIdForWebContents(event.sender)
    if (windowId) {
      windowManager.subscribe(windowId, connectionId)
      monitorService.addViewer(connectionId, windowId)
    }

    monitorService.startMonitoring(conn)
    return { success: true }
  })

  /**
   * Per-window stop: polling only halts when the last viewing window leaves.
   * A single window unmounting its MonitorView will NOT stop polling for
   * other windows that are still showing the same connection's monitor data.
   */
  ipcMain.handle('monitor:stop', (event, connectionId: string) => {
    const windowId = windowManager.getWindowIdForWebContents(event.sender)
    if (windowId) {
      const isLastViewer = monitorService.removeViewer(connectionId, windowId)
      if (isLastViewer) {
        monitorService.stopMonitoring(connectionId)
      }
    } else {
      // Sender window unknown — fall back to unconditional stop (safe default)
      monitorService.stopMonitoring(connectionId)
    }
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
