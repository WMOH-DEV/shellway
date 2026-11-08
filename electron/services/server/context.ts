import type { RemoteExec } from '../deploy/DeployService'
import type { ActionEngine } from './ActionEngine'
import type { ActivityStore } from './ActivityStore'
import type { ScanService } from './ScanService'

export interface ServerIpcContext {
  execFor(connectionId: string): RemoteExec | null
  broadcast(channel: string, ...args: unknown[]): void
  engine: ActionEngine
  scan: ScanService
  activity: ActivityStore
}
