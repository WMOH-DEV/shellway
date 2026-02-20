import { ipcMain } from 'electron'
import { HealthService } from '../services/HealthService'
import { getSSHService } from './ssh.ipc'

const healthService = new HealthService()

/**
 * Register health monitoring IPC handlers.
 *
 * Channels:
 *   ssh:getHealth → ConnectionHealth | null
 */
export function registerHealthIPC(): void {
  ipcMain.handle('ssh:getHealth', (_event, connectionId: string) => {
    return healthService.getHealth(connectionId)
  })
}

/** Get the health service singleton */
export function getHealthService(): HealthService {
  return healthService
}
