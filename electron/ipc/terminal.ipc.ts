import { ipcMain, type WebContents } from 'electron'
import { getSSHService } from './ssh.ipc'
import { getLogService, LogService } from '../services/LogService'
import type { ClientChannel } from 'ssh2'

/** Active shell channels by shellId */
const activeShells = new Map<string, ClientChannel>()
/** Window currently showing each shell — changes when a tab moves to another window */
const shellOwners = new Map<string, WebContents>()

function sendToOwner(shellId: string, channel: string, ...args: unknown[]): void {
  const owner = shellOwners.get(shellId)
  if (owner && !owner.isDestroyed()) owner.send(channel, ...args)
}

const MAX_DETACHED_OUTPUT = 256 * 1024
const detachedOutput = new Map<string, string>()

function deliverOutput(shellId: string, data: string): void {
  const backlog = detachedOutput.get(shellId)
  if (backlog === undefined) {
    sendToOwner(shellId, 'terminal:data', shellId, data)
    return
  }
  detachedOutput.set(shellId, (backlog + data).slice(-MAX_DETACHED_OUTPUT))
}

function forgetShell(shellId: string): void {
  activeShells.delete(shellId)
  shellOwners.delete(shellId)
  detachedOutput.delete(shellId)
}

const watchedOwners = new WeakSet<WebContents>()

function closeShellsOwnedBy(owner: WebContents): void {
  for (const [shellId, shellOwner] of shellOwners) {
    if (shellOwner !== owner) continue
    activeShells.get(shellId)?.end()
    forgetShell(shellId)
  }
}

export function detachShells(shellIds: string[]): string[] {
  const detached = shellIds.filter((shellId) => activeShells.has(shellId))
  for (const shellId of detached) {
    shellOwners.delete(shellId)
    if (!detachedOutput.has(shellId)) detachedOutput.set(shellId, '')
  }
  return detached
}

export function closeUnattachedShells(shellIds: string[]): void {
  for (const shellId of shellIds) {
    if (!detachedOutput.has(shellId) || shellOwners.has(shellId)) continue
    activeShells.get(shellId)?.end()
    forgetShell(shellId)
  }
}

function setShellOwner(shellId: string, owner: WebContents): void {
  shellOwners.set(shellId, owner)
  if (watchedOwners.has(owner)) return
  watchedOwners.add(owner)
  owner.once('destroyed', () => closeShellsOwnedBy(owner))
}

/**
 * Register terminal IPC handlers.
 *
 * Channels:
 *   terminal:open    → { success: boolean, error?: string }
 *   terminal:write   → void (write data to shell)
 *   terminal:resize  → void (resize terminal)
 *   terminal:close   → void (close shell)
 *   terminal:attach  → string | null (route an existing shell's output to the calling window; returns held output)
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

        if (event.sender.isDestroyed()) {
          shell.end()
          return { success: false, error: 'Window closed' }
        }

        activeShells.set(shellId, shell)
        setShellOwner(shellId, event.sender)
        LogService.shellOpened(logService, conn.sessionId, shellId)

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
              if (pendingData) deliverOutput(shellId, pendingData)
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
          sendToOwner(shellId, 'terminal:exit', shellId, 0)
          forgetShell(shellId)
          LogService.shellClosed(logService, conn.sessionId, shellId)
        })

        shell.on('exit', (code: number) => {
          if (!activeShells.has(shellId)) return
          sendToOwner(shellId, 'terminal:exit', shellId, code)
          forgetShell(shellId)
          LogService.shellClosed(logService, conn.sessionId, shellId)
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
      forgetShell(shellId)
    }
  })

  ipcMain.handle('terminal:attach', (event, shellId: string) => {
    if (!activeShells.has(shellId)) return null
    setShellOwner(shellId, event.sender)
    const backlog = detachedOutput.get(shellId) ?? ''
    detachedOutput.delete(shellId)
    return backlog
  })
}
