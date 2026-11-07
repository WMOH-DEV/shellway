import type { ActionDefinition, ActionStep, PlanBlock } from '@/types/server/core'
import { accessBlock, dockerPlan, dockerStep, PULL_TIMEOUT_SECONDS } from '../plan'
import { DOCKER_PROBE, dockerContainers, dockerState } from '../probes'
import { shellQuote } from '../shell'
import type { ComposeLabels, DockerState } from '../types'
import { asObject, isHostPath, oneOf, projectName } from '../validate'

export const COMPOSE_OPS = ['up', 'down', 'pull', 'restart'] as const
export type ComposeOp = (typeof COMPOSE_OPS)[number]

export interface ComposeParams {
  project: string
  op: ComposeOp
}

const TITLES: Record<ComposeOp, string> = {
  up: 'Start stack',
  down: 'Stop and remove stack',
  pull: 'Pull and recreate stack',
  restart: 'Restart stack'
}

const DOWN_WARNING = 'This stops and removes the stack containers and networks. Volumes stay.'

export function composeBase(labels: ComposeLabels): string {
  const files = labels.configFiles.map((file) => `-f ${shellQuote(file)}`)
  return [`cd ${shellQuote(labels.workingDir)} && docker compose -p ${shellQuote(labels.project)}`, ...files].join(' ')
}

function stepsFor(op: ComposeOp, labels: ComposeLabels, state: DockerState | null): ActionStep[] {
  const base = composeBase(labels)
  const long = { timeoutSeconds: PULL_TIMEOUT_SECONDS, detached: true }
  if (op === 'up') return [dockerStep('up', 'Start the stack', `${base} up -d`, state, long)]
  if (op === 'down') return [dockerStep('down', 'Stop and remove the stack', `${base} down`, state)]
  if (op === 'restart') return [dockerStep('restart', 'Restart the stack', `${base} restart`, state, { timeoutSeconds: 300 })]
  return [dockerStep('pull', 'Pull new images', `${base} pull`, state, long), dockerStep('up', 'Recreate changed containers', `${base} up -d`, state, long)]
}

function labelsBlock(labels: ComposeLabels | undefined, project: string): PlanBlock | null {
  if (!labels) return { kind: 'precondition', message: `No containers belong to the stack ${project}.` }
  const paths = [labels.workingDir, ...labels.configFiles]
  if (!paths.every(isHostPath)) return { kind: 'unsupported', message: 'The stack folder or compose file path has characters Shellway does not handle.' }
  return null
}

export const composeAction: ActionDefinition<ComposeParams> = {
  type: 'docker.compose',
  area: 'docker',
  needs: [DOCKER_PROBE.state, DOCKER_PROBE.containers],
  validate(raw) {
    const input = asObject(raw)
    return { project: projectName(input.project), op: oneOf(input.op, COMPOSE_OPS, 'Operation') }
  },
  plan(params, facts) {
    const state = dockerState(facts)
    const labels = dockerContainers(facts).find((container) => container.compose?.project === params.project)?.compose ?? undefined
    const blocked = accessBlock(state) ?? (state?.composeVersion ? null : { kind: 'unsupported' as const, message: 'The Docker Compose plugin is not installed.' }) ?? labelsBlock(labels, params.project)
    return dockerPlan({
      title: `${TITLES[params.op]} ${params.project}`,
      summary: labels ? `Runs in ${labels.workingDir}.` : '',
      steps: labels && !blocked ? stepsFor(params.op, labels, state) : [],
      warnings: params.op === 'down' ? [DOWN_WARNING] : [],
      blocked
    })
  }
}
