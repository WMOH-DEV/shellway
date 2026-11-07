import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { basename } from 'path'
import type { ServerResult } from '../../../../src/types/server/core'
import { BACKUP_FILE } from '../../../../src/utils/server/databases/backupScripts'
import type { RemoteExec } from '../../../services/deploy/DeployService'
import type { ServerIpcContext } from '../../../services/server/context'
import { SFTPService } from '../../../services/SFTPService'
import { shellEscape } from '../../../utils/shellEscape'
import { getSSHService } from '../../ssh.ipc'

export const DOWNLOAD_CHANNEL = 'server:databases:download'

const COPY_TIMEOUT_MS = 10 * 60_000
const TEMP_COPY = /^\/[A-Za-z0-9._/-]*\/\.shellway-dl\.[A-Za-z0-9]+$/

export interface DownloadResult {
  savedTo: string
}

export function copyForDownloadScript(path: string): string {
  return [
    'set -e',
    'home=$(getent passwd "$SUDO_USER" | cut -d: -f6)',
    '[ -n "$home" ] && [ -d "$home" ]',
    't=$(mktemp "$home/.shellway-dl.XXXXXXXX")',
    `cp ${shellEscape(path)} "$t"`,
    'chown "$SUDO_UID:$SUDO_GID" "$t"',
    'chmod 600 "$t"',
    'printf \'%s\\n\' "$t"',
    ''
  ].join('\n')
}

export async function copyForDownload(exec: RemoteExec, path: string): Promise<string> {
  const result = await exec('sudo -n sh -s', { stdin: copyForDownloadScript(path), timeoutMs: COPY_TIMEOUT_MS })
  const temp = result.stdout.trim()
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'Could not prepare the backup for download')
  if (!TEMP_COPY.test(temp) || temp.includes('..')) throw new Error('The server returned an unexpected temporary path')
  return temp
}

async function sftpDownload(connectionId: string, remote: string, local: string): Promise<void> {
  const conn = getSSHService().get(connectionId)
  if (!conn) throw new Error('Not connected')
  const sftp = await conn.getSFTP()
  try {
    await new SFTPService(sftp).download(remote, local, `db-backup-${Date.now()}`)
  } finally {
    sftp.end()
  }
}

async function download(ctx: ServerIpcContext, event: IpcMainInvokeEvent, connectionId: unknown, path: unknown): Promise<ServerResult<DownloadResult | null>> {
  if (typeof connectionId !== 'string' || typeof path !== 'string' || !BACKUP_FILE.test(path)) return { success: false, error: 'Invalid backup file' }
  const exec = ctx.execFor(connectionId)
  if (!exec) return { success: false, error: 'Not connected' }
  const window = BrowserWindow.fromWebContents(event.sender)
  const options = { defaultPath: basename(path) }
  const choice = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (choice.canceled || !choice.filePath) return { success: true, data: null }
  try {
    const temp = await copyForDownload(exec, path)
    try {
      await sftpDownload(connectionId, temp, choice.filePath)
    } finally {
      await exec(`rm -f ${shellEscape(temp)}`).catch(() => undefined)
    }
    return { success: true, data: { savedTo: choice.filePath } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerDatabasesIPC(ctx: ServerIpcContext): void {
  ipcMain.handle(DOWNLOAD_CHANNEL, (event, connectionId: unknown, path: unknown) => download(ctx, event, connectionId, path))
}
