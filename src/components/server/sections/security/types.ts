import type { GuardRequest, SecuritySessionInfo } from '@/utils/server/security/guard'

export interface SecurityActions {
  canGuard: boolean
  session: SecuritySessionInfo | null
  guard(request: GuardRequest): void
  launch(type: string, params: unknown): void
}
