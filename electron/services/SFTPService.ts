import { type SFTPWrapper, type FileEntry as SSH2FileEntry, type Stats } from 'ssh2'
import { createReadStream, createWriteStream, promises as fsp } from 'fs'
import { join, basename, dirname, posix } from 'path'
import { EventEmitter } from 'events'

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
  modifiedAt: number
  accessedAt: number
  permissions: number
  owner: number
  group: number
  symlinkTarget?: string
}

/**
 * SFTPService — wraps the ssh2 SFTP subsystem for all file operations.
 * Emits: 'progress' for transfer tracking.
 */
export class SFTPService extends EventEmitter {
  private sftp: SFTPWrapper

  constructor(sftp: SFTPWrapper) {
    super()
    this.sftp = sftp
  }

  /** List directory contents */
  async readdir(remotePath: string): Promise<FileEntry[]> {
    return new Promise((resolve, reject) => {
      this.sftp.readdir(remotePath, (err, list) => {
        if (err) {
          reject(err)
          return
        }

        const entries: FileEntry[] = list.map((item: SSH2FileEntry) => {
          const attrs = item.attrs
          const isDirectory = (attrs.mode! & 0o40000) !== 0
          const isSymlink = (attrs.mode! & 0o120000) === 0o120000

          return {
            name: item.filename,
            path: posix.join(remotePath, item.filename),
            isDirectory,
            isSymlink,
            size: attrs.size ?? 0,
            modifiedAt: (attrs.mtime ?? 0) * 1000,
            accessedAt: (attrs.atime ?? 0) * 1000,
            permissions: attrs.mode! & 0o7777,
            owner: attrs.uid ?? 0,
            group: attrs.gid ?? 0
          }
        })

        resolve(entries)
      })
    })
  }

  /** Get file/directory stats */
  async stat(remotePath: string): Promise<FileEntry> {
    return new Promise((resolve, reject) => {
      this.sftp.stat(remotePath, (err, stats) => {
        if (err) {
          reject(err)
          return
        }
        resolve(this.statsToEntry(remotePath, stats))
      })
    })
  }

  /** Read symlink target */
  async readlink(remotePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.sftp.readlink(remotePath, (err, target) => {
        if (err) reject(err)
        else resolve(target)
      })
    })
  }

  /** Get real (absolute) path */
  async realpath(remotePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.sftp.realpath(remotePath, (err, absPath) => {
        if (err) reject(err)
        else resolve(absPath)
      })
    })
  }

  /** Create directory */
  async mkdir(remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.mkdir(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /** Create directory recursively */
  async mkdirRecursive(remotePath: string): Promise<void> {
    const parts = remotePath.split('/').filter(Boolean)
    let current = ''
    for (const part of parts) {
      current += '/' + part
      try {
        await this.stat(current)
      } catch {
        await this.mkdir(current)
      }
    }
  }

  /** Remove file */
  async unlink(remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.unlink(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /** Remove empty directory */
  async rmdir(remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.rmdir(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /** Remove directory recursively */
  async rmdirRecursive(remotePath: string): Promise<void> {
    const entries = await this.readdir(remotePath)
    for (const entry of entries) {
      if (entry.isDirectory) {
        await this.rmdirRecursive(entry.path)
      } else {
        await this.unlink(entry.path)
      }
    }
    await this.rmdir(remotePath)
  }

  /** Rename / move file or directory */
  async rename(oldPath: string, newPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.rename(oldPath, newPath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /** Change file permissions */
  async chmod(remotePath: string, mode: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.chmod(remotePath, mode, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /** Change file permissions recursively */
  async chmodRecursive(remotePath: string, mode: number): Promise<void> {
    const stat = await this.stat(remotePath)
    await this.chmod(remotePath, mode)
    if (stat.isDirectory) {
      const entries = await this.readdir(remotePath)
      for (const entry of entries) {
        await this.chmodRecursive(entry.path, mode)
      }
    }
  }

  /** Change ownership */
  async chown(remotePath: string, uid: number, gid: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.chown(remotePath, uid, gid, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /** Create symbolic link */
  async symlink(targetPath: string, linkPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sftp.symlink(targetPath, linkPath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /**
   * Download a file from remote to local.
   * Emits 'progress' events with (transferId, transferred, total).
   */
  async download(
    remotePath: string,
    localPath: string,
    transferId: string
  ): Promise<void> {
    const stats = await this.stat(remotePath)
    const totalBytes = stats.size

    return new Promise((resolve, reject) => {
      const readStream = this.sftp.createReadStream(remotePath)
      const writeStream = createWriteStream(localPath)
      let transferred = 0

      readStream.on('data', (chunk: Buffer) => {
        transferred += chunk.length
        this.emit('progress', transferId, transferred, totalBytes)
      })

      readStream.on('error', reject)
      writeStream.on('error', reject)
      writeStream.on('finish', resolve)

      readStream.pipe(writeStream)
    })
  }

  /**
   * Upload a file from local to remote.
   * Emits 'progress' events with (transferId, transferred, total).
   */
  async upload(
    localPath: string,
    remotePath: string,
    transferId: string
  ): Promise<void> {
    const localStats = await fsp.stat(localPath)
    const totalBytes = localStats.size

    return new Promise((resolve, reject) => {
      const readStream = createReadStream(localPath)
      const writeStream = this.sftp.createWriteStream(remotePath)
      let transferred = 0

      readStream.on('data', (chunk: Buffer) => {
        transferred += chunk.length
        this.emit('progress', transferId, transferred, totalBytes)
      })

      readStream.on('error', reject)
      writeStream.on('error', reject)
      writeStream.on('finish', resolve)

      readStream.pipe(writeStream)
    })
  }

  /** Read a text file */
  async readFile(remotePath: string, maxSize: number = 1024 * 1024): Promise<string> {
    const stats = await this.stat(remotePath)
    if (stats.size > maxSize) {
      throw new Error(`File too large: ${stats.size} bytes (max: ${maxSize})`)
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const stream = this.sftp.createReadStream(remotePath)
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('error', reject)
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    })
  }

  /** Write content to a file */
  async writeFile(remotePath: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = this.sftp.createWriteStream(remotePath)
      stream.on('error', reject)
      stream.on('finish', resolve)
      stream.end(content, 'utf-8')
    })
  }

  /** Check if file/dir exists */
  async exists(remotePath: string): Promise<boolean> {
    try {
      await this.stat(remotePath)
      return true
    } catch {
      return false
    }
  }

  /** Destroy/close the SFTP session */
  close(): void {
    this.sftp.end()
  }

  private statsToEntry(path: string, stats: Stats): FileEntry {
    return {
      name: basename(path) || path,
      path,
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      size: stats.size,
      modifiedAt: (stats.mtime ?? 0) * 1000,
      accessedAt: (stats.atime ?? 0) * 1000,
      permissions: stats.mode & 0o7777,
      owner: stats.uid,
      group: stats.gid
    }
  }
}
