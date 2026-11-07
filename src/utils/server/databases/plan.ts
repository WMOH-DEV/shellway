import type { ActionPlan, ActionStep, ServerFacts } from '@/types/server/core'
import { engineFacts, engineLabel } from './facts'
import type { DbEngine, DbUser, EngineFacts } from './types'

export interface PlanParts {
  title: string
  summary: string
  steps: ActionStep[]
  warnings?: string[]
  secrets?: string[]
}

export function makePlan(parts: PlanParts): ActionPlan {
  return { area: 'databases', warnings: [], secrets: [], blocked: null, ...parts }
}

export function blockedPlan(title: string, message: string): ActionPlan {
  return { title, area: 'databases', summary: message, steps: [], warnings: [], secrets: [], blocked: { kind: 'precondition', message } }
}

export function withEngine(facts: ServerFacts, engine: DbEngine, title: string, build: (data: EngineFacts) => ActionPlan): ActionPlan {
  const data = engineFacts(facts, engine)
  if (!data) return blockedPlan(title, `${engineLabel(engine)} could not be checked. Refresh and try again.`)
  if (data.status !== 'ok') return blockedPlan(title, data.reason)
  return build(data)
}

export const hasDatabase = (data: EngineFacts, name: string): boolean => data.databases.some((database) => database.name === name)

export function findUser(data: EngineFacts, name: string, host: string): DbUser | undefined {
  return data.users.find((user) => user.name === name && (data.engine === 'postgresql' || user.host === host))
}

export function accountLabel(engine: DbEngine, user: string, host: string): string {
  return engine === 'mysql' ? `${user}@${host}` : user
}
