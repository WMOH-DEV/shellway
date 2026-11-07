import type { ActionPlan, ActionStep, ServerFacts } from '@/types/server/core'

export const EXIT_CHANGED = 74

export function factData<T>(facts: ServerFacts, id: string): T | null {
  const result = facts[id]
  return result?.status === 'ok' ? (result.data as T) : null
}

export function jobsPlan(fields: Pick<ActionPlan, 'title' | 'summary' | 'steps'> & Partial<ActionPlan>): ActionPlan {
  return { area: 'jobs', warnings: [], blocked: null, secrets: [], ...fields }
}

export const blockedPlan = (title: string, message: string): ActionPlan =>
  jobsPlan({ title, summary: message, steps: [], blocked: { kind: 'precondition', message } })

export function commandStep(step: Pick<ActionStep, 'id' | 'label' | 'root' | 'script'> & Partial<ActionStep>): ActionStep {
  return { kind: 'command', display: step.script, timeoutSeconds: 60, ...step }
}

export function lineDiff(before: string, after: string): string {
  const old = before === '' ? [] : before.replace(/\n$/, '').split('\n')
  const next = after === '' ? [] : after.replace(/\n$/, '').split('\n')
  const kept = new Set(next)
  const had = new Set(old)
  const removed = old.filter((line) => !kept.has(line)).map((line) => `- ${line}`)
  const added = next.map((line) => (had.has(line) ? `  ${line}` : `+ ${line}`))
  return [...removed, ...added].join('\n')
}
