import type { ActionPlan, ActionStep, PlanBlockKind, ServerFacts } from '@/types/server/core'
import { IDENTITY_PROBE, type ServerIdentity } from '@/types/server/identity'

export const okData = <T>(facts: ServerFacts, id: string): T | null => {
  const result = facts[id]
  return result?.status === 'ok' ? (result.data as T) : null
}

export function softwarePlan(title: string, summary: string, steps: ActionStep[], warnings: string[] = []): ActionPlan {
  return { title, area: 'software', summary, steps, warnings, blocked: null, secrets: [] }
}

export function blockedPlan(title: string, kind: PlanBlockKind, message: string): ActionPlan {
  return { ...softwarePlan(title, '', []), blocked: { kind, message } }
}

interface CommandOptions {
  timeoutSeconds?: number
  detached?: boolean
}

export function rootCommand(id: string, label: string, script: string, { timeoutSeconds = 60, detached = false }: CommandOptions = {}): ActionStep {
  return { id, label, kind: 'command', root: true, script, display: script.trim(), timeoutSeconds, detached }
}

export const LONG_APT = { timeoutSeconds: 900, detached: true }

const APT_FAMILIES = new Set(['ubuntu', 'debian'])

export function unsupportedOsMessage(facts: ServerFacts): string | null {
  const identity = okData<ServerIdentity>(facts, IDENTITY_PROBE)
  if (!identity || APT_FAMILIES.has(identity.os.family)) return null
  return `Software management is not available on ${identity.os.prettyName} yet. It works on Ubuntu and Debian.`
}

export function changedLines(before: string, after: string): string {
  const old = before.split('\n')
  const next = after.split('\n')
  const lines: string[] = []
  for (let index = 0; index < Math.max(old.length, next.length); index++) {
    if (old[index] === next[index]) continue
    if (old[index] !== undefined && old[index] !== '') lines.push(`-${old[index]}`)
    if (next[index] !== undefined && next[index] !== '') lines.push(`+${next[index]}`)
  }
  return lines.join('\n')
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function setDirectives(content: string, values: Record<string, string>): string {
  const lines = content === '' ? [] : content.replace(/\n$/, '').split('\n')
  const pending = new Map(Object.entries(values))
  for (const [key, value] of [...pending]) {
    const active = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`)
    const commented = new RegExp(`^\\s*;\\s*${escapeRegex(key)}\\s*=`)
    const at = lines.findIndex((line) => active.test(line))
    const target = at >= 0 ? at : lines.findIndex((line) => commented.test(line))
    if (target < 0) continue
    lines[target] = `${key} = ${value}`
    pending.delete(key)
  }
  for (const [key, value] of pending) lines.push(`${key} = ${value}`)
  return `${lines.join('\n')}\n`
}
