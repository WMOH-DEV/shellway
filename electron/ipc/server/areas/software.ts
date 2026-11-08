import { ipcMain } from 'electron'
import type { ServerResult } from '../../../../src/types/server/core'
import { parseSearch, searchScript, assertSearchQuery } from '../../../../src/utils/server/software/search'
import type { PackageHit } from '../../../../src/utils/server/software/types'
import type { RemoteExec } from '../../../services/deploy/DeployService'
import type { ServerIpcContext } from '../../../services/server/context'

const SEARCH_TIMEOUT_MS = 20_000

const failure = (error: unknown): ServerResult<never> => ({ success: false, error: error instanceof Error ? error.message : String(error) })

export async function searchPackages(exec: RemoteExec, rawQuery: unknown): Promise<ServerResult<PackageHit[]>> {
  try {
    const query = assertSearchQuery(rawQuery)
    const result = await exec('sh -s', { stdin: searchScript(query), timeoutMs: SEARCH_TIMEOUT_MS })
    const hits = parseSearch(result.stdout)
    if (hits === null) return { success: false, error: 'Package search needs apt, which this server does not have.' }
    return { success: true, data: hits }
  } catch (error) {
    return failure(error)
  }
}

export function registerSoftwareIPC(ctx: ServerIpcContext): void {
  ipcMain.handle('server:software:search', (_event, connectionId: unknown, query: unknown) => {
    const exec = typeof connectionId === 'string' ? ctx.execFor(connectionId) : null
    if (!exec) return failure('Not connected')
    return searchPackages(exec, query)
  })
}
