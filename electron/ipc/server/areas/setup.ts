import { ipcMain } from 'electron'
import type { ServerResult } from '../../../../src/types/server/core'
import type { ServerIpcContext } from '../../../services/server/context'
import { sessionConfigOf } from '../../../services/serverSecurity/sessionConfig'
import { checkUserLogin } from '../../../services/serverSecurity/userLogin'
import { getSSHService } from '../../ssh.ipc'

const CONNECTION_ID = /^[A-Za-z0-9:._-]{1,128}$/

export function registerSetupIPC(_ctx: ServerIpcContext): void {
  ipcMain.handle('server:setup-check-login', async (_event, connectionId: unknown, user: unknown): Promise<ServerResult> => {
    try {
      if (typeof connectionId !== 'string' || !CONNECTION_ID.test(connectionId)) throw new Error('Invalid connection')
      if (typeof user !== 'string') throw new Error('Choose a user to log in as')
      const connection = getSSHService().get(connectionId)
      if (!connection) throw new Error('Not connected. Reconnect, then try again.')
      await checkUserLogin(await sessionConfigOf(connection), user)
      return { success: true, data: undefined }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
