import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import type { ServerResult } from '../../../../src/types/server/core'
import type { ServerIpcContext } from '../../../services/server/context'

const MAX_EXPORT_BYTES = 64 * 1024 * 1024
const FILE_NAME = /^[a-z0-9-]{1,80}\.(json|txt)$/
type ExportFormat = 'json' | 'txt'

const FILTERS: Record<ExportFormat, Electron.FileFilter> = {
  json: { name: 'JSON', extensions: ['json'] },
  txt: { name: 'Text', extensions: ['txt'] }
}

export function registerActivityIPC(_ctx: ServerIpcContext): void {
  ipcMain.handle('server:activity-export', async (event, format: unknown, fileName: unknown, content: unknown): Promise<ServerResult<{ saved: boolean }>> => {
    try {
      const request = exportRequest(format, fileName, content)
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options = { defaultPath: request.fileName, filters: [FILTERS[request.format]] }
      const choice = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
      if (choice.canceled || !choice.filePath) return { success: true, data: { saved: false } }
      await writeFile(choice.filePath, request.content, 'utf8')
      return { success: true, data: { saved: true } }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}

function exportRequest(format: unknown, fileName: unknown, content: unknown): { format: ExportFormat; fileName: string; content: string } {
  if (format !== 'json' && format !== 'txt') throw new Error('Invalid export format')
  if (typeof fileName !== 'string' || !FILE_NAME.test(fileName) || !fileName.endsWith(`.${format}`)) throw new Error('Invalid file name')
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_EXPORT_BYTES) throw new Error('The export is too large')
  return { format, fileName, content }
}
