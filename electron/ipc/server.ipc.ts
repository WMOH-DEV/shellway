import { broadcast } from '../services/WindowManager'
import { sshExec } from '../utils/sshExec'
import { getSSHService } from './ssh.ipc'
import type { RemoteExec } from '../services/deploy/DeployService'
import type { ServerIpcContext } from '../services/server/context'
import { registerServerAreaIPC } from './server/areas'

function execFor(connectionId: string): RemoteExec | null {
  const conn = getSSHService().get(connectionId)
  if (!conn || conn.status !== 'connected') return null
  return (command, options) => sshExec(conn, command, options)
}

export function registerServerIPC(): void {
  const ctx: ServerIpcContext = { execFor, broadcast }
  registerServerAreaIPC(ctx)
}
