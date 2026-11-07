import type { ActionPlan, ActionStep, PlanBlock } from '@/types/server/core'
import { runsAsRoot } from './shell'
import type { DockerState } from './types'

export function accessBlock(state: DockerState | null): PlanBlock | null {
  if (!state) return { kind: 'precondition', message: 'Docker status is not known yet. Refresh and try again.' }
  if (!state.installed) return { kind: 'unsupported', message: 'Docker is not installed on this server.' }
  if (state.access === 'none') return { kind: 'sudo', message: 'This user is not in the docker group and cannot use sudo without a password.' }
  if (!state.serverVersion) return { kind: 'precondition', message: 'The Docker service is not running.' }
  return null
}

export interface StepOptions {
  timeoutSeconds?: number
  detached?: boolean
  rollback?: string
  root?: boolean
}

export function dockerStep(id: string, label: string, command: string, state: DockerState | null, options: StepOptions = {}): ActionStep {
  return {
    id,
    label,
    kind: 'command',
    root: options.root ?? runsAsRoot(state?.access ?? 'none'),
    script: `set -e\n${command}\n`,
    display: command,
    timeoutSeconds: options.timeoutSeconds ?? 120,
    ...(options.detached ? { detached: true } : {}),
    ...(options.rollback ? { rollback: options.rollback } : {})
  }
}

export interface PlanParts {
  title: string
  summary: string
  steps: ActionStep[]
  warnings?: string[]
  blocked?: PlanBlock | null
  secrets?: string[]
}

export function dockerPlan(parts: PlanParts): ActionPlan {
  return {
    title: parts.title,
    area: 'docker',
    summary: parts.summary,
    steps: parts.steps,
    warnings: parts.warnings ?? [],
    blocked: parts.blocked ?? null,
    secrets: parts.secrets ?? []
  }
}

export const PULL_TIMEOUT_SECONDS = 900
