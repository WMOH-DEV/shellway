import { ipcMain, BrowserWindow } from 'electron'
import { promises as fsp } from 'fs'
import { join, basename, parse as parsePath, posix } from 'path'
import { homedir } from 'os'
import { getSSHService } from './ssh.ipc'
import { getSettingsStore } from './settings.ipc'
import { getSessionStore } from './session.ipc'
import { SFTPService, type FileEntry } from '../services/SFTPService'
import { TransferQueue, type TransferItem } from '../services/TransferQueue'
import { getLogService, LogService } from '../services/LogService'
import { getNotificationService } from '../services/NotificationService'
import type { SFTPConflictResolution } from '../../src/types/settings'

// ── Conflict resolution helpers ──

/**
 * Generate a conflict-free path by appending a counter suffix.
 * file.txt → file (1).txt → file (2).txt, etc.
 * Works for both local and remote via the `existsFn` callback.
 */
async function getConflictFreePath(
  basePath: string,
  existsFn: (p: string) => Promise<boolean>,
  pathModule: { dir: string; name: string; ext: string }
): Promise<string> {
  let counter = 1
  let candidate: string
  do {
    candidate = join(pathModule.dir, `${pathModule.name} (${counter})${pathModule.ext}`)
    counter++
  } while (await existsFn(candidate))
  return candidate
}

/** Same as getConflictFreePath but uses posix paths (for remote) */
async function getConflictFreeRemotePath(
  basePath: string,
  existsFn: (p: string) => Promise<boolean>
): Promise<string> {
  const dir = posix.dirname(basePath)
  const ext = posix.extname(basePath)
  const name = posix.basename(basePath, ext)
  let counter = 1
  let candidate: string
  do {
    candidate = posix.join(dir, `${name} (${counter})${ext}`)
    counter++
  } while (await existsFn(candidate))
  return candidate
}

interface FileInfo {
  name: string
  size: number
  modifiedAt: number
}

interface ConflictResult {
  action: 'proceed' | 'skip' | 'conflict'
  /** Modified destination path (only for 'rename' policy) */
  destinationPath?: string
  /** File info for 'ask' policy conflict response */
  existingFile?: FileInfo
  newFile?: FileInfo
}

/**
 * Determine what to do when the destination already exists.
 * Returns an action: proceed (overwrite/enqueue), skip, or conflict (ask the user).
 */
async function resolveTransferConflict(opts: {
  policy: SFTPConflictResolution
  direction: 'download' | 'upload'
  sourcePath: string
  destinationPath: string
  sftp: SFTPService
}): Promise<ConflictResult> {
  const { policy, direction, sourcePath, destinationPath, sftp } = opts

  // Check if destination exists
  let destExists: boolean
  if (direction === 'download') {
    try {
      await fsp.stat(destinationPath)
      destExists = true
    } catch {
      destExists = false
    }
  } else {
    destExists = await sftp.exists(destinationPath)
  }

  if (!destExists) {
    return { action: 'proceed' }
  }

  // Destination exists — apply policy
  switch (policy) {
    case 'overwrite':
      return { action: 'proceed' }

    case 'skip':
      return { action: 'skip' }

    case 'overwrite-newer': {
      // Get source mtime
      let sourceMtime: number
      let destMtime: number
      if (direction === 'download') {
        const remoteStat = await sftp.stat(sourcePath)
        sourceMtime = remoteStat.modifiedAt
        const localStat = await fsp.stat(destinationPath)
        destMtime = localStat.mtimeMs
      } else {
        const localStat = await fsp.stat(sourcePath)
        sourceMtime = localStat.mtimeMs
        const remoteStat = await sftp.stat(destinationPath)
        destMtime = remoteStat.modifiedAt
      }
      return sourceMtime > destMtime ? { action: 'proceed' } : { action: 'skip' }
    }

    case 'rename': {
      let newDest: string
      if (direction === 'download') {
        const parsed = parsePath(destinationPath)
        const localExistsFn = async (p: string) => {
          try { await fsp.access(p); return true } catch { return false }
        }
        newDest = await getConflictFreePath(destinationPath, localExistsFn, parsed)
      } else {
        const remoteExistsFn = (p: string) => sftp.exists(p)
        newDest = await getConflictFreeRemotePath(destinationPath, remoteExistsFn)
      }
      return { action: 'proceed', destinationPath: newDest }
    }

    case 'ask':
    default: {
      // Gather info about both files for the renderer dialog
      let existingFile: FileInfo
      let newFile: FileInfo
      if (direction === 'download') {
        const localStat = await fsp.stat(destinationPath)
        existingFile = {
          name: basename(destinationPath),
          size: localStat.size,
          modifiedAt: localStat.mtimeMs
        }
        const remoteStat = await sftp.stat(sourcePath)
        newFile = {
          name: basename(sourcePath),
          size: remoteStat.size,
          modifiedAt: remoteStat.modifiedAt
        }
      } else {
        const remoteStat = await sftp.stat(destinationPath)
        existingFile = {
          name: basename(destinationPath),
          size: remoteStat.size,
          modifiedAt: remoteStat.modifiedAt
        }
        const localStat = await fsp.stat(sourcePath)
        newFile = {
          name: basename(sourcePath),
          size: localStat.size,
          modifiedAt: localStat.mtimeMs
        }
      }
      return { action: 'conflict', existingFile, newFile }
    }
  }
}

/**
 * Read the effective conflict resolution policy.
 * Priority: explicit resolution param > session override > global setting > 'ask'
 */
function getEffectiveConflictPolicy(
  connectionId: string,
  explicitResolution?: string
): SFTPConflictResolution {
  if (explicitResolution) {
    return explicitResolution as SFTPConflictResolution
  }

  const sshService = getSSHService()
  const conn = sshService.get(connectionId)
  const sessionData = conn?.sessionId ? getSessionStore().getById(conn.sessionId) : undefined
  const sessionPolicy = sessionData?.overrides?.sftp?.defaultConflictResolution

  if (sessionPolicy) {
    return sessionPolicy
  }

  const globalSettings = getSettingsStore().getAll()
  return globalSettings.sftpDefaultConflictResolution ?? 'ask'
}

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

      // Create transfer queue — read settings from session override > global setting > default
      const globalSettings = getSettingsStore().getAll()
      const sessionData = conn.sessionId ? getSessionStore().getById(conn.sessionId) : undefined
      const sftpOverrides = sessionData?.overrides?.sftp

      const concurrency = sftpOverrides?.concurrentTransfers ?? globalSettings.sftpConcurrentTransfers ?? 3
      const queue = new TransferQueue(concurrency)
      queue.bandwidthLimitUp = sftpOverrides?.bandwidthLimitUp ?? globalSettings.sftpBandwidthLimit ?? 0
      queue.bandwidthLimitDown = sftpOverrides?.bandwidthLimitDown ?? globalSettings.sftpBandwidthLimitDown ?? 0
      queue.preserveTimestamps = sftpOverrides?.preserveTimestamps ?? globalSettings.sftpPreserveTimestamps ?? true
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
      // Read followSymlinks from session override > global setting > default (true)
      const sshService = getSSHService()
      const conn = sshService.get(connectionId)
      const globalSettings = getSettingsStore().getAll()
      const sessionData = conn?.sessionId ? getSessionStore().getById(conn.sessionId) : undefined
      const followSymlinks = sessionData?.overrides?.sftp?.followSymlinks ?? globalSettings.sftpFollowSymlinks ?? true

      const entries = await sftp.readdir(remotePath, followSymlinks)
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
    totalBytes: number,
    resolution?: string
  ) => {
    const queue = transferQueues.get(connectionId)
    if (!queue) return { success: false, error: 'Transfer queue not initialized' }

    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }

    try {
      const policy = getEffectiveConflictPolicy(connectionId, resolution)
      const result = await resolveTransferConflict({
        policy,
        direction: 'download',
        sourcePath: remotePath,
        destinationPath: localPath,
        sftp
      })

      if (result.action === 'skip') {
        return { success: true, skipped: true }
      }

      if (result.action === 'conflict') {
        return {
          success: false,
          conflict: true,
          existingFile: result.existingFile,
          newFile: result.newFile
        }
      }

      // 'proceed' — use possibly renamed destination
      const finalLocalPath = result.destinationPath ?? localPath

      queue.enqueue({
        id: transferId,
        fileName: basename(remotePath),
        sourcePath: remotePath,
        destinationPath: finalLocalPath,
        direction: 'download',
        totalBytes
      })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Conflict check failed' }
    }
  })

  ipcMain.handle('sftp:upload', async (
    _event,
    connectionId: string,
    transferId: string,
    localPath: string,
    remotePath: string,
    totalBytes: number,
    resolution?: string
  ) => {
    const queue = transferQueues.get(connectionId)
    if (!queue) return { success: false, error: 'Transfer queue not initialized' }

    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }

    try {
      const policy = getEffectiveConflictPolicy(connectionId, resolution)
      const result = await resolveTransferConflict({
        policy,
        direction: 'upload',
        sourcePath: localPath,
        destinationPath: remotePath,
        sftp
      })

      if (result.action === 'skip') {
        return { success: true, skipped: true }
      }

      if (result.action === 'conflict') {
        return {
          success: false,
          conflict: true,
          existingFile: result.existingFile,
          newFile: result.newFile
        }
      }

      // 'proceed' — use possibly renamed destination
      const finalRemotePath = result.destinationPath ?? remotePath

      queue.enqueue({
        id: transferId,
        fileName: basename(localPath),
        sourcePath: localPath,
        destinationPath: finalRemotePath,
        direction: 'upload',
        totalBytes
      })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'Conflict check failed' }
    }
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
