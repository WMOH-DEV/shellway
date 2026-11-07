import type { ActionPlan, ActionStep, PlanBlock, ServerFacts } from '@/types/server/core'

export function factData<T>(facts: ServerFacts, id: string): T | null {
  const result = facts[id]
  return result?.status === 'ok' ? (result.data as T) : null
}

export function securityPlan(input: { title: string; summary: string; steps: ActionStep[]; warnings?: string[]; blocked?: PlanBlock | null }): ActionPlan {
  return { title: input.title, area: 'security', summary: input.summary, steps: input.steps, warnings: input.warnings ?? [], blocked: input.blocked ?? null, secrets: [] }
}

export const precondition = (message: string): PlanBlock => ({ kind: 'precondition', message })

export const needsRoot = (what: string): PlanBlock => ({ kind: 'sudo', message: `${what} needs passwordless sudo (sudo -n) on this server.` })

export const unavailable = (what: string): PlanBlock => precondition(`Could not read ${what}. Refresh and try again.`)

export function commandStep(id: string, label: string, script: string, options: Partial<Pick<ActionStep, 'root' | 'rollback' | 'timeoutSeconds' | 'detached' | 'display'>> = {}): ActionStep {
  return {
    id,
    label,
    kind: 'command',
    root: options.root ?? true,
    script,
    display: options.display ?? script.replace(/^set -e\n/, ''),
    timeoutSeconds: options.timeoutSeconds ?? 60,
    detached: options.detached,
    rollback: options.rollback
  }
}
