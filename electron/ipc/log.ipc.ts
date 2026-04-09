import { ipcMain } from 'electron'
import { getLogService } from '../services/LogService'
import { windowManager } from '../services/WindowManager'

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

  // Logs are global (not scoped to a single connection), so broadcast to every
  // live window regardless of subscription.
  logService.on('entry', (sessionId: string, entry: unknown) => {
    windowManager.broadcastToAll('log:entry', sessionId, entry)
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
