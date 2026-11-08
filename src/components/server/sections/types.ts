import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ServerRoute, ServerSection } from '@/types/server/core'
import type { ConnectionStatus } from '@/types/session'

export interface ServerSectionContext {
  tabId: string
  connectionId: string
  sessionId: string
  sessionName: string
  connectionStatus: ConnectionStatus
  route: ServerRoute
  active: boolean
  navigate(route: ServerRoute): void
}

export interface SectionModule {
  id: ServerSection
  label: string
  icon: LucideIcon
  placement: 'main' | 'bottom' | 'hidden'
  Component: ComponentType<{ ctx: ServerSectionContext }>
}
