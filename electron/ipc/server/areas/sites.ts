import { ipcMain } from 'electron'
import type { ServerResult } from '../../../../src/types/server/core'
import { parseTail, tailScript, validLogRequest } from '../../../../src/utils/server/sites/logs'
import type { SiteLogResult } from '../../../../src/utils/server/sites/types'
import type { ServerIpcContext } from '../../../services/server/context'

const TAIL_TIMEOUT_MS = 15_000

export async function tailSiteLog(ctx: ServerIpcContext, connectionId: unknown, raw: unknown): Promise<ServerResult<SiteLogResult>> {
  try {
    if (typeof connectionId !== 'string') throw new Error('Invalid connection')
    const request = validLogRequest(raw)
    const exec = ctx.execFor(connectionId)
    if (!exec) return { success: false, error: 'Not connected to this server' }
    const result = await exec('sh -s', { stdin: tailScript(request), timeoutMs: TAIL_TIMEOUT_MS })
    if (result.code !== 0) return { success: false, error: result.stderr.trim() || 'Could not read the log' }
    return { success: true, data: parseTail(result.stdout) }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

export function registerSitesIPC(ctx: ServerIpcContext): void {
  ipcMain.handle('server:sites:tail', (_event, connectionId: unknown, request: unknown) => tailSiteLog(ctx, connectionId, request))
}
