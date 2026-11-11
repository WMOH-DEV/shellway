import { ipcMain } from 'electron'
import { PortForwardService } from '../services/PortForwardService'
import { broadcast } from '../services/WindowManager'
import type { PortForwardStartResult } from '../../src/types/portForward'
import { parseForwardSpec } from '../services/portForwardSpec'
import type { SSHConnection } from '../services/SSHService'
import { getSSHService } from './ssh.ipc'
import { getSessionStore } from './session.ipc'

const portForwardService = new PortForwardService((connectionId) => broadcast('portforward:changed', connectionId))

export async function startSavedForwards(conn: SSHConnection, savedSessionId: string | undefined): Promise<void> {
  if (!savedSessionId) return
  const rules = getSessionStore().getById(savedSessionId)?.portForwardings ?? []
  const specs = rules.filter((rule) => rule.autoStart).flatMap((rule) => {
    try {
      return [parseForwardSpec(rule)]
    } catch {
      return []
    }
  })
  await Promise.all(specs.map((spec) => portForwardService.add(conn, spec)))
}

export function registerPortForwardIPC(): void {
  ipcMain.handle('portforward:add', async (_event, connectionId: string, raw: unknown): Promise<PortForwardStartResult> => {
    const conn = getSSHService().get(connectionId)
    if (!conn || conn.status !== 'connected') return { success: false, error: 'Not connected' }

    try {
      const entry = await portForwardService.add(conn, parseForwardSpec(raw))
      return { success: entry.status === 'active', data: entry, error: entry.error }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  ipcMain.handle('portforward:remove', (_event, connectionId: string, ruleId: string) => {
    return portForwardService.remove(connectionId, ruleId)
  })

  ipcMain.handle('portforward:list', (_event, connectionId: string) => {
    return portForwardService.list(connectionId)
  })
}

export function getPortForwardService(): PortForwardService {
  return portForwardService
}
