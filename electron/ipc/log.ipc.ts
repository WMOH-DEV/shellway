import { ipcMain, BrowserWindow } from 'electron'
import { getLogService } from '../services/LogService'

/**
 * Register log-related IPC handlers.
 *
 * Channels:
 *   log:getEntries(sessionId) → LogEntry[]
 *   log:clear(sessionId) → void
 *   log:export(sessionId) → string (formatted log text)
 *
 * Events sent to renderer:
 *   log:entry → (sessionId, LogEntry) — real-time log entry forwarding
 */
export function registerLogIPC(): void {
  const logService = getLogService()

  // Forward log entries to all renderer windows in real time
  logService.on('entry', (sessionId: string, entry: unknown) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('log:entry', sessionId, entry)
      }
    }
  })

  ipcMain.handle('log:getEntries', (_event, sessionId: string) => {
    return logService.getEntries(sessionId)
  })

  ipcMain.handle('log:clear', (_event, sessionId: string) => {
    logService.clearEntries(sessionId)
  })

  ipcMain.handle('log:export', (_event, sessionId: string) => {
    return logService.exportLog(sessionId)
  })
}
