import { ipcMain, BrowserWindow } from 'electron'
import { getSSHService } from './ssh.ipc'
import { getLogService, LogService } from '../services/LogService'
import type { ClientChannel } from 'ssh2'

/** Active shell channels by shellId */
const activeShells = new Map<string, ClientChannel>()

/**
 * Register terminal IPC handlers.
 *
 * Channels:
 *   terminal:open    → { success: boolean, error?: string }
 *   terminal:write   → void (write data to shell)
 *   terminal:resize  → void (resize terminal)
 *   terminal:close   → void (close shell)
 *
 * Events sent to renderer:
 *   terminal:data    → (shellId, data) — shell output
 *   terminal:exit    → (shellId, code) — shell closed
 */
export function registerTerminalIPC(): void {
  const logService = getLogService()

  ipcMain.handle(
    'terminal:open',
    async (
      event,
      connectionId: string,
      shellId: string,
      options?: { cols?: number; rows?: number }
    ) => {
      try {
        const sshService = getSSHService()
        const conn = sshService.get(connectionId)

        if (!conn || conn.status !== 'connected') {
          return { success: false, error: 'Not connected' }
        }

        const shell = await conn.openShell(shellId, {
          cols: options?.cols || 80,
          rows: options?.rows || 24,
          term: 'xterm-256color'
        })

        activeShells.set(shellId, shell)
        LogService.shellOpened(logService, conn.sessionId, shellId)

        const win = BrowserWindow.fromWebContents(event.sender)

        // Forward shell output to renderer — batch rapid data chunks into a single
        // IPC message per tick. High-throughput output (e.g. `cat largefile.txt`)
        // fires many tiny data events; without batching, each one triggers a separate
        // IPC serialization + deserialization cycle that congests the main thread.
        let pendingData = ''
        let flushScheduled = false
        shell.on('data', (data: Buffer) => {
          pendingData += data.toString('utf-8')
          if (!flushScheduled) {
            flushScheduled = true
            process.nextTick(() => {
              if (pendingData && win && !win.isDestroyed()) {
                win.webContents.send('terminal:data', shellId, pendingData)
              }
              pendingData = ''
              flushScheduled = false
            })
          }
        })

        // Handle shell close — guard against double-fire (ssh2 can emit both
        // 'close' and 'exit' for the same shell; without the guard, the renderer
        // receives two terminal:exit events and LogService logs close twice).
        shell.on('close', () => {
          if (!activeShells.has(shellId)) return
          activeShells.delete(shellId)
          LogService.shellClosed(logService, conn.sessionId, shellId)
          win?.webContents.send('terminal:exit', shellId, 0)
        })

        shell.on('exit', (code: number) => {
          if (!activeShells.has(shellId)) return
          activeShells.delete(shellId)
          LogService.shellClosed(logService, conn.sessionId, shellId)
          win?.webContents.send('terminal:exit', shellId, code)
        })

        return { success: true }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to open shell'
        return { success: false, error: message }
      }
    }
  )

  // Fire-and-forget: terminal:write does not need a response.
  // Using ipcMain.on (not .handle) eliminates the round-trip IPC cost per keystroke.
  ipcMain.on('terminal:write', (_event, shellId: string, data: string) => {
    const shell = activeShells.get(shellId)
    if (shell && shell.writable) {
      shell.write(data)
    }
  })

  // Fire-and-forget: terminal:resize does not need a response.
  ipcMain.on(
    'terminal:resize',
    (_event, shellId: string, cols: number, rows: number) => {
      const shell = activeShells.get(shellId)
      if (shell) {
        shell.setWindow(rows, cols, 0, 0)
      }
    }
  )

  ipcMain.handle('terminal:close', (_event, shellId: string) => {
    const shell = activeShells.get(shellId)
    if (shell) {
      shell.end()
      activeShells.delete(shellId)
    }
  })
}
