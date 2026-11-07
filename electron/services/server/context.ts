import type { RemoteExec } from '../deploy/DeployService'

export interface ServerIpcContext {
  execFor(connectionId: string): RemoteExec | null
  broadcast(channel: string, ...args: unknown[]): void
}
