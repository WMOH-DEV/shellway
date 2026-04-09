import { ipcMain } from 'electron'
import { getSSHService } from './ssh.ipc'
import { getLogService, LogService } from '../services/LogService'
import { windowManager } from '../services/WindowManager'
import type { ClientChannel } from 'ssh2'

/** Active shell channels by shellId */
const activeShells = new Map<string, ClientChannel>()
/** Shell ownership: shellId → connectionId (for event routing via WindowManager) */
const shellToConnection = new Map<string, string>()

/**
 * Per-shell replay buffer used during terminal pop-out.
 *
 * When a terminal is popped out into a new BrowserWindow, there is a gap
 * between the moment the new window is created (and pre-subscribed to the
 * connection's event stream) and the moment its renderer mounts the xterm
 * listener. Any shell output that fires during that gap would otherwise be
 * broadcast to a window whose ipcRenderer has no handler yet, and be lost
 * (Electron does not buffer IPC events without a listener).
 *
 * Fix: when a pop-out starts (main.ts:window:openStandalone sees a shellId),
 * call `startPendingAttach(shellId)`. While an entry exists in this map, the
 * shell.on('data') handler appends to the buffer **instead of** broadcasting.
 * When the new window's TerminalView finishes mounting, it calls the
 * `terminal:attach` IPC, which returns the buffered delta and deletes the
 * entry. Subsequent shell output resumes broadcasting normally.
 *
 * Buffer is capped at 256 KB per shell; on overflow we drop the oldest bytes
 * and leave a marker so the user can tell.
 */
const pendingAttach = new Map<string, string>()
const PENDING_BUFFER_LIMIT = 256 * 1024
const TRUNCATE_MARKER = '\r\n\x1b[33m[…older output dropped during pop-out…]\x1b[0m\r\n'

/**
 * Mark a shellId as "pop-out in flight". Called by main.ts right when
 * `window:openStandalone` is invoked with a shellId, BEFORE it returns to
 * the source window. The source window then disposes its xterm view; any
 * shell output in between is captured here.
 */
export function startPendingAttach(shellId: string): void {
  pendingAttach.set(shellId, '')
}

/** Clear a pending-attach entry without consuming its buffer (e.g. on cancel). */
export function cancelPendingAttach(shellId: string): void {
  pendingAttach.delete(shellId)
}

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
      _event,
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
        shellToConnection.set(shellId, connectionId)
        LogService.shellOpened(logService, conn.sessionId, shellId)

        // Forward shell output via WindowManager — every window subscribed to
        // this connectionId receives the event. Batch rapid data chunks into a
        // single IPC message per tick: high-throughput output (e.g. `cat
        // largefile.txt`) fires many tiny data events; without batching, each
        // one triggers a separate IPC serialization + deserialization cycle
        // that congests the main thread.
        //
        // Pop-out replay: while `pendingAttach` has an entry for this shellId,
        // buffer the data instead of broadcasting. The new standalone window
        // drains the buffer via `terminal:attach` once its xterm listener is
        // registered, avoiding a lost-output gap during window creation.
        let pendingData = ''
        let flushScheduled = false
        shell.on('data', (data: Buffer) => {
          const chunk = data.toString('utf-8')

          // Suppress broadcast while a pop-out is in flight for this shell.
          // The new window's terminal:attach call will drain the buffer.
          if (pendingAttach.has(shellId)) {
            let buffered = pendingAttach.get(shellId)! + chunk
            if (buffered.length > PENDING_BUFFER_LIMIT) {
              // Keep the tail (most recent output) to preserve cursor position.
              const keep = buffered.length - (PENDING_BUFFER_LIMIT - TRUNCATE_MARKER.length)
              buffered = TRUNCATE_MARKER + buffered.slice(keep)
            }
            pendingAttach.set(shellId, buffered)
            return
          }

          pendingData += chunk
          if (!flushScheduled) {
            flushScheduled = true
            process.nextTick(() => {
              if (pendingData) {
                windowManager.broadcastToConnection(connectionId, 'terminal:data', shellId, pendingData)
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
          shellToConnection.delete(shellId)
          pendingAttach.delete(shellId)
          LogService.shellClosed(logService, conn.sessionId, shellId)
          windowManager.broadcastToConnection(connectionId, 'terminal:exit', shellId, 0)
        })

        shell.on('exit', (code: number) => {
          if (!activeShells.has(shellId)) return
          activeShells.delete(shellId)
          shellToConnection.delete(shellId)
          pendingAttach.delete(shellId)
          LogService.shellClosed(logService, conn.sessionId, shellId)
          windowManager.broadcastToConnection(connectionId, 'terminal:exit', shellId, code)
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
      shellToConnection.delete(shellId)
    }
    pendingAttach.delete(shellId)
  })

  /**
   * Drain the pending-attach replay buffer for a shellId and resume normal
   * broadcasting. Called by the standalone TerminalView once its xterm
   * listener is registered. The returned string contains all shell output
   * captured during the window-creation gap and should be written to xterm
   * before (or right after) the bufferSnapshot.
   *
   * Safe to call when no pending entry exists — returns an empty string.
   */
  ipcMain.handle('terminal:attach', (_event, shellId: string) => {
    const buffered = pendingAttach.get(shellId) ?? ''
    pendingAttach.delete(shellId)
    return buffered
  })
}
