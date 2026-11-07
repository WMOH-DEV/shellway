import type { ActionRun } from '@/types/server/core'

export interface LaunchRequest {
  type: string
  params: unknown
  onFinished?: (run: ActionRun) => void
}

export interface ActionLauncher {
  launch(request: LaunchRequest): void
}

export interface ActionHostProps {
  tabId: string
  connectionId: string
  sessionKey: string
}
