import { ipcMain } from 'electron'
import { PortForwardService } from '../services/PortForwardService'
import { getSSHService } from './ssh.ipc'

const portForwardService = new PortForwardService()

/**
 * Register port forwarding IPC handlers.
 *
 * Channels:
 *   portforward:add    → PortForwardEntry
 *   portforward:remove → boolean
 *   portforward:list   → PortForwardEntry[]
 */
export function registerPortForwardIPC(): void {
  ipcMain.handle(
    'portforward:add',
    async (
      _event,
      connectionId: string,
      rule: {
        id: string
        type: 'local' | 'remote' | 'dynamic'
        name?: string
        sourceHost: string
        sourcePort: number
        destinationHost?: string
        destinationPort?: number
      }
    ) => {
      const sshService = getSSHService()
      const conn = sshService.get(connectionId)
      if (!conn || conn.status !== 'connected') {
        return { success: false, error: 'Not connected' }
      }

      try {
        const entry = await portForwardService.add(conn, rule)
        return { success: entry.status === 'active', data: entry, error: entry.error }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  ipcMain.handle('portforward:remove', (_event, connectionId: string, ruleId: string) => {
    return portForwardService.remove(connectionId, ruleId)
  })

  ipcMain.handle('portforward:list', (_event, connectionId: string) => {
    return portForwardService.list(connectionId)
  })
}

/** Get the port forward service singleton */
export function getPortForwardService(): PortForwardService {
  return portForwardService
}
