import { ipcMain, BrowserWindow } from 'electron'
import { promises as fsp } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { getSSHService } from './ssh.ipc'
import { getSettingsStore } from './settings.ipc'
import { getSessionStore } from './session.ipc'
import { SFTPService, type FileEntry } from '../services/SFTPService'
import { TransferQueue, type TransferItem } from '../services/TransferQueue'
import { getLogService, LogService } from '../services/LogService'
import { getNotificationService } from '../services/NotificationService'

/** Active SFTP services by connectionId */
const sftpServices = new Map<string, SFTPService>()
const transferQueues = new Map<string, TransferQueue>()

/**
 * Register all SFTP IPC handlers.
 */
export function registerSFTPIPC(): void {
  const logService = getLogService()

  // ── Open SFTP session ──
  ipcMain.handle('sftp:open', async (event, connectionId: string) => {
    try {
      const sshService = getSSHService()
      const conn = sshService.get(connectionId)
      if (!conn || conn.status !== 'connected') {
        return { success: false, error: 'Not connected' }
      }

      const sftpWrapper = await conn.getSFTP()
      const sftpService = new SFTPService(sftpWrapper)
      sftpServices.set(connectionId, sftpService)

      // Create transfer queue — read concurrency from session override > global setting > default (3)
      const globalSettings = getSettingsStore().getAll()
      const globalConcurrency = globalSettings.sftpConcurrentTransfers ?? 3
      const sessionData = conn.sessionId ? getSessionStore().getById(conn.sessionId) : undefined
      const concurrency = sessionData?.overrides?.sftp?.concurrentTransfers ?? globalConcurrency
      const queue = new TransferQueue(concurrency)
      queue.setSFTPService(sftpService)
      transferQueues.set(connectionId, queue)

      const win = BrowserWindow.fromWebContents(event.sender)
      const sessionId = conn.sessionId

      // Forward transfer updates to renderer + log transfers
      queue.on('update', (item: TransferItem) => {
        win?.webContents.send('sftp:transfer-update', connectionId, item)

        if (item.status === 'active' && item.transferredBytes === 0) {
          LogService.transferStarted(logService, sessionId, item.fileName, item.direction)
        }
      })
      queue.on('complete', (item: TransferItem) => {
        win?.webContents.send('sftp:transfer-complete', connectionId, item)
        LogService.transferCompleted(logService, sessionId, item.fileName)
        getNotificationService()?.notifyTransferComplete(item.fileName)
      })
      queue.on('error', (item: TransferItem) => {
        LogService.transferFailed(logService, sessionId, item.fileName, item.error || 'Unknown error')
      })

      LogService.sftpOpened(logService, sessionId)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to open SFTP' }
    }
  })

  // ── Read remote directory ──
  ipcMain.handle('sftp:readdir', async (_event, connectionId: string, remotePath: string) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      const entries = await sftp.readdir(remotePath)
      return { success: true, data: entries }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'readdir failed' }
    }
  })

  // ── Get remote file stats ──
  ipcMain.handle('sftp:stat', async (_event, connectionId: string, remotePath: string) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      const entry = await sftp.stat(remotePath)
      return { success: true, data: entry }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'stat failed' }
    }
  })

  // ── Resolve real path ──
  ipcMain.handle('sftp:realpath', async (_event, connectionId: string, remotePath: string) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      const resolved = await sftp.realpath(remotePath)
      return { success: true, data: resolved }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'realpath failed' }
    }
  })

  // ── Create directory ──
  ipcMain.handle('sftp:mkdir', async (_event, connectionId: string, remotePath: string) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      await sftp.mkdir(remotePath)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'mkdir failed' }
    }
  })

  // ── Delete file ──
  ipcMain.handle('sftp:unlink', async (_event, connectionId: string, remotePath: string) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      await sftp.unlink(remotePath)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'unlink failed' }
    }
  })

  // ── Delete directory recursively ──
  ipcMain.handle('sftp:rmdir', async (_event, connectionId: string, remotePath: string, recursive: boolean) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      if (recursive) {
        await sftp.rmdirRecursive(remotePath)
      } else {
        await sftp.rmdir(remotePath)
      }
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'rmdir failed' }
    }
  })

  // ── Rename / move ──
  ipcMain.handle('sftp:rename', async (_event, connectionId: string, oldPath: string, newPath: string) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      await sftp.rename(oldPath, newPath)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'rename failed' }
    }
  })

  // ── Change permissions ──
  ipcMain.handle('sftp:chmod', async (_event, connectionId: string, remotePath: string, mode: number, recursive: boolean) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      if (recursive) {
        await sftp.chmodRecursive(remotePath, mode)
      } else {
        await sftp.chmod(remotePath, mode)
      }
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'chmod failed' }
    }
  })

  // ── Read file content ──
  ipcMain.handle('sftp:readFile', async (_event, connectionId: string, remotePath: string) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      const content = await sftp.readFile(remotePath)
      return { success: true, data: content }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'readFile failed' }
    }
  })

  // ── Write file content ──
  ipcMain.handle('sftp:writeFile', async (_event, connectionId: string, remotePath: string, content: string) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      await sftp.writeFile(remotePath, content)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'writeFile failed' }
    }
  })

  // ── Create symlink ──
  ipcMain.handle('sftp:symlink', async (_event, connectionId: string, targetPath: string, linkPath: string) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      await sftp.symlink(targetPath, linkPath)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'symlink failed' }
    }
  })

  // ── Transfer operations ──
  ipcMain.handle('sftp:download', async (
    _event,
    connectionId: string,
    transferId: string,
    remotePath: string,
    localPath: string,
    totalBytes: number
  ) => {
    const queue = transferQueues.get(connectionId)
    if (!queue) return { success: false, error: 'Transfer queue not initialized' }
    queue.enqueue({
      id: transferId,
      fileName: basename(remotePath),
      sourcePath: remotePath,
      destinationPath: localPath,
      direction: 'download',
      totalBytes
    })
    return { success: true }
  })

  ipcMain.handle('sftp:upload', async (
    _event,
    connectionId: string,
    transferId: string,
    localPath: string,
    remotePath: string,
    totalBytes: number
  ) => {
    const queue = transferQueues.get(connectionId)
    if (!queue) return { success: false, error: 'Transfer queue not initialized' }
    queue.enqueue({
      id: transferId,
      fileName: basename(localPath),
      sourcePath: localPath,
      destinationPath: remotePath,
      direction: 'upload',
      totalBytes
    })
    return { success: true }
  })

  // ── Transfer queue controls ──
  ipcMain.handle('sftp:transfer-pause', (_event, connectionId: string, transferId: string) => {
    transferQueues.get(connectionId)?.pause(transferId)
  })

  ipcMain.handle('sftp:transfer-resume', (_event, connectionId: string, transferId: string) => {
    transferQueues.get(connectionId)?.resume(transferId)
  })

  ipcMain.handle('sftp:transfer-cancel', (_event, connectionId: string, transferId: string) => {
    transferQueues.get(connectionId)?.cancel(transferId)
  })

  ipcMain.handle('sftp:transfer-retry', (_event, connectionId: string, transferId: string) => {
    transferQueues.get(connectionId)?.retry(transferId)
  })

  ipcMain.handle('sftp:transfer-list', (_event, connectionId: string) => {
    return transferQueues.get(connectionId)?.getAll() || []
  })

  // ── Local filesystem operations ──
  ipcMain.handle('sftp:local-readdir', async (_event, localPath: string) => {
    try {
      const dirents = await fsp.readdir(localPath, { withFileTypes: true })
      const entries: FileEntry[] = []

      for (const dirent of dirents) {
        try {
          const fullPath = join(localPath, dirent.name)
          const stats = await fsp.stat(fullPath)
          entries.push({
            name: dirent.name,
            path: fullPath,
            isDirectory: dirent.isDirectory(),
            isSymlink: dirent.isSymbolicLink(),
            size: stats.size,
            modifiedAt: stats.mtimeMs,
            accessedAt: stats.atimeMs,
            permissions: stats.mode & 0o7777,
            owner: stats.uid,
            group: stats.gid
          })
        } catch {
          // Skip inaccessible files
        }
      }

      return { success: true, data: entries }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'readdir failed' }
    }
  })

  ipcMain.handle('sftp:local-homedir', () => {
    return homedir()
  })

  // ── Close SFTP session ──
  ipcMain.handle('sftp:close', (_event, connectionId: string) => {
    const sftp = sftpServices.get(connectionId)
    if (sftp) {
      sftp.close()
      sftpServices.delete(connectionId)
    }
    const queue = transferQueues.get(connectionId)
    if (queue) {
      queue.cancelAll()
      transferQueues.delete(connectionId)
    }

    // Log SFTP close — find the connection's sessionId
    const sshService = getSSHService()
    const conn = sshService.get(connectionId)
    if (conn) {
      LogService.sftpClosed(logService, conn.sessionId)
    }
  })
}
