import type { ActionEngine } from '../ActionEngine'
import type { ActivityStore } from '../ActivityStore'
import type { ServerIpcContext } from '../context'
import type { ScanService } from '../ScanService'

export function testIpcContext(overrides: Pick<ServerIpcContext, 'execFor' | 'broadcast'> & Partial<ServerIpcContext>): ServerIpcContext {
  return { engine: {} as ActionEngine, scan: {} as ScanService, activity: {} as ActivityStore, ...overrides }
}
