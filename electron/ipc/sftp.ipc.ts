import { ipcMain, BrowserWindow, shell } from 'electron'
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
const MAX_RENAME_ATTEMPTS = 10000

async function getConflictFreePath(
  existsFn: (p: string) => Promise<boolean>,
  pathModule: { dir: string; name: string; ext: string }
): Promise<string> {
  for (let counter = 1; counter <= MAX_RENAME_ATTEMPTS; counter++) {
    const candidate = join(pathModule.dir, `${pathModule.name} (${counter})${pathModule.ext}`)
    if (!(await existsFn(candidate))) return candidate
  }
  throw new Error('Too many conflicting files — could not find a unique name')
}

/** Same as getConflictFreePath but uses posix paths (for remote) */
async function getConflictFreeRemotePath(
  basePath: string,
  existsFn: (p: string) => Promise<boolean>
): Promise<string> {
  const dir = posix.dirname(basePath)
  const ext = posix.extname(basePath)
  const name = posix.basename(basePath, ext)
  for (let counter = 1; counter <= MAX_RENAME_ATTEMPTS; counter++) {
    const candidate = posix.join(dir, `${name} (${counter})${ext}`)
    if (!(await existsFn(candidate))) return candidate
  }
  throw new Error('Too many conflicting files — could not find a unique name')
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
      try {
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
      } catch {
        // Cannot determine file age — fall back to overwrite
        return { action: 'proceed' }
      }
    }

    case 'rename': {
      let newDest: string
      if (direction === 'download') {
        const parsed = parsePath(destinationPath)
        const localExistsFn = async (p: string) => {
          try { await fsp.access(p); return true } catch { return false }
        }
        newDest = await getConflictFreePath(localExistsFn, parsed)
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

// ── Directory transfer helpers ──

/**
 * Result of expanding a folder into individual file transfers.
 * `conflicts` counts files skipped because the policy was 'ask' — nothing in the
 * renderer can prompt per-file mid-tree, so those are left untouched and reported.
 */
interface DirectoryTransferResult {
  success: true
  directory: true
  enqueued: number
  skipped: number
  conflicts: number
}

/**
 * Mirror a remote directory tree locally, enqueueing one transfer per file.
 * Directories merge (the universal file-manager behaviour) rather than being
 * replaced, so an existing destination folder keeps files the source lacks.
 */
async function enqueueDirectoryDownload(opts: {
  queue: TransferQueue
  sftp: SFTPService
  policy: SFTPConflictResolution
  transferId: string
  remotePath: string
  localPath: string
}): Promise<DirectoryTransferResult> {
  const { queue, sftp, policy, transferId, remotePath, localPath } = opts

  // A plain file sitting where the folder should go makes mkdir fail with a raw
  // EEXIST. Earlier builds created exactly such a file when a folder download
  // was attempted, so say what is wrong instead of leaking errno.
  let existing: Awaited<ReturnType<typeof fsp.stat>> | null = null
  try {
    existing = await fsp.stat(localPath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err
  }
  if (existing && !existing.isDirectory()) {
    throw new Error(
      `A file named '${basename(localPath)}' already exists here — rename or remove it first`
    )
  }

  const tree = await sftp.walkTree(remotePath)

  await fsp.mkdir(localPath, { recursive: true })
  for (const node of tree) {
    if (node.isDirectory) {
      await fsp.mkdir(join(localPath, ...node.relativePath.split('/')), { recursive: true })
    }
  }

  let enqueued = 0
  let skipped = 0
  let conflicts = 0

  for (const node of tree) {
    if (node.isDirectory) continue

    const destPath = join(localPath, ...node.relativePath.split('/'))
    const conflict = await resolveTransferConflict({
      policy,
      direction: 'download',
      sourcePath: node.path,
      destinationPath: destPath,
      sftp
    })

    if (conflict.action === 'skip') { skipped++; continue }
    // Only the 'ask' policy yields 'conflict', and nothing can prompt per-file
    // mid-tree — leave the file alone and report the count instead.
    if (conflict.action === 'conflict') { conflicts++; continue }

    queue.enqueue({
      id: `${transferId}-${enqueued}`,
      fileName: node.relativePath,
      sourcePath: node.path,
      destinationPath: conflict.destinationPath ?? destPath,
      direction: 'download',
      totalBytes: node.size
    })
    enqueued++
  }

  return { success: true, directory: true, enqueued, skipped, conflicts }
}

/** Walk a local directory tree, mirroring `SFTPService.walkTree`'s shape. */
async function walkLocalTree(
  rootPath: string
): Promise<{ path: string; relativePath: string; isDirectory: boolean; size: number }[]> {
  const collected: { path: string; relativePath: string; isDirectory: boolean; size: number }[] = []

  const visit = async (dir: string, prefix: string): Promise<void> => {
    const dirents = await fsp.readdir(dir, { withFileTypes: true })
    for (const dirent of dirents) {
      const fullPath = join(dir, dirent.name)
      const relativePath = prefix ? `${prefix}/${dirent.name}` : dirent.name
      // Never follow symlinks — one pointing at an ancestor would loop forever
      if (dirent.isSymbolicLink()) continue
      if (dirent.isDirectory()) {
        collected.push({ path: fullPath, relativePath, isDirectory: true, size: 0 })
        await visit(fullPath, relativePath)
      } else if (dirent.isFile()) {
        let size = 0
        try { size = (await fsp.stat(fullPath)).size } catch { /* unreadable — enqueue anyway */ }
        collected.push({ path: fullPath, relativePath, isDirectory: false, size })
      }
    }
  }

  await visit(rootPath, '')
  return collected
}

/** Mirror a local directory tree onto the remote, enqueueing one transfer per file. */
async function enqueueDirectoryUpload(opts: {
  queue: TransferQueue
  sftp: SFTPService
  policy: SFTPConflictResolution
  transferId: string
  localPath: string
  remotePath: string
}): Promise<DirectoryTransferResult> {
  const { queue, sftp, policy, transferId, localPath, remotePath } = opts

  // mkdirRecursive treats "path already exists" as done, so a file occupying the
  // destination would be silently accepted and every child upload would then
  // fail against a non-directory. Catch it once, up front.
  try {
    const existing = await sftp.stat(remotePath)
    if (!existing.isDirectory) {
      throw new Error(
        `A file named '${posix.basename(remotePath)}' already exists there — rename or remove it first`
      )
    }
  } catch (err: unknown) {
    // stat throwing means it doesn't exist, which is the normal case
    if (err instanceof Error && err.message.startsWith('A file named')) throw err
  }

  const tree = await walkLocalTree(localPath)

  await sftp.mkdirRecursive(remotePath)
  for (const node of tree) {
    if (node.isDirectory) {
      await sftp.mkdirRecursive(posix.join(remotePath, node.relativePath))
    }
  }

  let enqueued = 0
  let skipped = 0
  let conflicts = 0

  for (const node of tree) {
    if (node.isDirectory) continue

    const destPath = posix.join(remotePath, node.relativePath)
    const conflict = await resolveTransferConflict({
      policy,
      direction: 'upload',
      sourcePath: node.path,
      destinationPath: destPath,
      sftp
    })

    if (conflict.action === 'skip') { skipped++; continue }
    // Only the 'ask' policy yields 'conflict', and nothing can prompt per-file
    // mid-tree — leave the file alone and report the count instead.
    if (conflict.action === 'conflict') { conflicts++; continue }

    queue.enqueue({
      id: `${transferId}-${enqueued}`,
      fileName: node.relativePath,
      sourcePath: node.path,
      destinationPath: conflict.destinationPath ?? destPath,
      direction: 'upload',
      totalBytes: node.size
    })
    enqueued++
  }

  return { success: true, directory: true, enqueued, skipped, conflicts }
}

/** Active SFTP services by connectionId */
const sftpServices = new Map<string, SFTPService>()
const transferQueues = new Map<string, TransferQueue>()

/**
 * Clean up SFTP resources for a connection.
 * Called when the SSH connection disconnects to ensure SFTP services are freed.
 */
export function cleanupSFTP(connectionId: string): void {
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
}

/**
 * Clean up ALL SFTP resources.
 * Called on app quit / disconnectAll to prevent resource leaks.
 */
export function cleanupAllSFTP(): void {
  for (const [connectionId] of sftpServices) {
    cleanupSFTP(connectionId)
  }
}

/**
 * Register all SFTP IPC handlers.
 */
export function registerSFTPIPC(): void {
  const logService = getLogService()

  // ── Open SFTP session ──
  ipcMain.handle('sftp:open', async (event, connectionId: string) => {
    try {
      // Idempotent: if already open and usable, return success.
      // Probe liveness to catch stale sessions (e.g., server closed the channel).
      if (sftpServices.has(connectionId)) {
        try {
          await sftpServices.get(connectionId)!.realpath('.')
          return { success: true }
        } catch {
          // Stale SFTP session — clean up and recreate below
          cleanupSFTP(connectionId)
        }
      }

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

  // ── Read first N bytes of a file (instant partial preview) ──
  ipcMain.handle('sftp:readFileHead', async (_event, connectionId: string, remotePath: string, bytes?: number) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }
    try {
      const result = await sftp.readFileHead(remotePath, bytes)
      return { success: true, data: result.content, totalSize: result.totalSize }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'readFileHead failed' }
    }
  })

  // ── Read file content (with progress reporting) ──
  ipcMain.handle('sftp:readFile', async (_event, connectionId: string, remotePath: string, maxSize?: number, readId?: string) => {
    const sftp = sftpServices.get(connectionId)
    if (!sftp) return { success: false, error: 'SFTP not open' }

    // Forward progress events to the renderer
    let progressListener: ((id: string, transferred: number, total: number) => void) | null = null
    if (readId) {
      const win = BrowserWindow.getAllWindows()[0]
      progressListener = (id: string, transferred: number, total: number) => {
        if (id === readId) {
          win?.webContents.send('sftp:readFile-progress', connectionId, readId, transferred, total)
        }
      }
      sftp.on('readProgress', progressListener)
    }

    try {
      const content = await sftp.readFile(remotePath, maxSize, readId)
      return { success: true, data: content }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'readFile failed' }
    } finally {
      // Clean up progress listener
      if (progressListener) {
        sftp.removeListener('readProgress', progressListener)
      }
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

      // Directories can't be streamed like a file — mirror the tree instead.
      // Without this the download below creates an empty local file named after
      // the folder.
      let sourceIsDirectory = false
      try {
        sourceIsDirectory = (await sftp.stat(remotePath)).isDirectory
      } catch {
        // Source vanished or is unreadable — let the file path below report it
      }
      if (sourceIsDirectory) {
        return await enqueueDirectoryDownload({
          queue, sftp, policy, transferId, remotePath, localPath
        })
      }

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

      let sourceIsDirectory = false
      try {
        sourceIsDirectory = (await fsp.stat(localPath)).isDirectory()
      } catch {
        // Source vanished — let the file path below report it
      }
      if (sourceIsDirectory) {
        return await enqueueDirectoryUpload({
          queue, sftp, policy, transferId, localPath, remotePath
        })
      }

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

  ipcMain.handle('sftp:local-mkdir', async (_event, localPath: string) => {
    try {
      await fsp.mkdir(localPath, { recursive: true })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'mkdir failed' }
    }
  })

  ipcMain.handle('sftp:local-writeFile', async (_event, localPath: string, content: string) => {
    try {
      await fsp.writeFile(localPath, content, 'utf8')
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'write failed' }
    }
  })

  ipcMain.handle('sftp:local-rename', async (_event, oldPath: string, newPath: string) => {
    try {
      await fsp.rename(oldPath, newPath)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'rename failed' }
    }
  })

  ipcMain.handle('sftp:local-copy', async (_event, sourcePath: string, destPath: string) => {
    try {
      // `recursive` covers directories; for a plain file it behaves like copyFile.
      await fsp.cp(sourcePath, destPath, { recursive: true, errorOnExist: true, force: false })
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'copy failed' }
    }
  })

  /**
   * Move a local file/folder to the OS trash rather than unlinking it.
   * Deleting from the machine the user is sitting at should be recoverable —
   * unlike a remote delete, where there is no trash to fall back on.
   */
  ipcMain.handle('sftp:local-trash', async (_event, localPath: string) => {
    try {
      await shell.trashItem(localPath)
      return { success: true }
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : 'delete failed' }
    }
  })

  ipcMain.handle('sftp:local-exists', async (_event, localPath: string) => {
    try {
      await fsp.access(localPath)
      return true
    } catch {
      return false
    }
  })

  // ── Close SFTP session ──
  ipcMain.handle('sftp:close', (_event, connectionId: string) => {
    cleanupSFTP(connectionId)

    // Log SFTP close — find the connection's sessionId
    const sshService = getSSHService()
    const conn = sshService.get(connectionId)
    if (conn) {
      LogService.sftpClosed(logService, conn.sessionId)
    }
  })
}
