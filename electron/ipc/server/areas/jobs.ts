import { ipcMain } from 'electron'
import type { RemoteExec } from '../../../services/deploy/DeployService'
import type { ServerIpcContext } from '../../../services/server/context'
import { logTailScript, validateLogTarget, type LogTarget } from '../../../../src/utils/server/jobs/logs'
import type { ServerResult } from '../../../../src/types/server/core'

const TAIL_TIMEOUT_MS = 20_000

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export async function readJobLog(exec: RemoteExec, target: LogTarget): Promise<string> {
  const result = await exec('sh -s', { stdin: logTailScript(target), timeoutMs: TAIL_TIMEOUT_MS })
  if (result.code !== 0 && result.stdout.trim() === '') throw new Error(result.stderr.trim() || `The log could not be read (exit ${result.code})`)
  return result.stdout
}

export async function tailJobLog(ctx: ServerIpcContext, connectionId: unknown, target: unknown): Promise<ServerResult<string>> {
  try {
    if (typeof connectionId !== 'string' || connectionId === '') throw new Error('Invalid connection')
    const valid = validateLogTarget(target)
    const exec = ctx.execFor(connectionId)
    if (!exec) return { success: false, error: 'Not connected' }
    return { success: true, data: await readJobLog(exec, valid) }
  } catch (error) {
    return { success: false, error: errorText(error) }
  }
}

export function registerJobsIPC(ctx: ServerIpcContext): void {
  ipcMain.handle('server:jobs:tail', (_event, connectionId: unknown, target: unknown) => tailJobLog(ctx, connectionId, target))
}
