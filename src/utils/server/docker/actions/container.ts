import type { ActionDefinition, ActionStep, ServerFacts } from '@/types/server/core'
import { accessBlock, dockerPlan, dockerStep } from '../plan'
import { DOCKER_PROBE, dockerContainers, dockerState } from '../probes'
import { shellQuote } from '../shell'
import type { DockerContainer } from '../types'
import { asObject, containerRef, oneOf } from '../validate'

export const CONTAINER_OPS = ['start', 'stop', 'restart', 'remove'] as const
export type ContainerOp = (typeof CONTAINER_OPS)[number]

export interface ContainerParams {
  name: string
  op: ContainerOp
}

const TITLES: Record<ContainerOp, string> = {
  start: 'Start container',
  stop: 'Stop container',
  restart: 'Restart container',
  remove: 'Remove container'
}

const findContainer = (facts: ServerFacts, name: string): DockerContainer | undefined =>
  dockerContainers(facts).find((container) => container.name === name || container.id === name)

function removeSteps(container: DockerContainer | undefined, name: string, facts: ServerFacts): ActionStep[] {
  const state = dockerState(facts)
  const remove = dockerStep('remove', 'Remove the container', `docker rm ${name}`, state)
  if (container?.status !== 'running' && container?.status !== 'restarting') return [remove]
  return [dockerStep('stop', 'Stop the container', `docker stop ${name}`, state), remove]
}

function stepsFor(params: ContainerParams, container: DockerContainer | undefined, facts: ServerFacts): ActionStep[] {
  const name = shellQuote(params.name)
  if (params.op === 'remove') return removeSteps(container, name, facts)
  return [dockerStep(params.op, TITLES[params.op], `docker ${params.op} ${name}`, dockerState(facts))]
}

const REMOVE_WARNING = 'This deletes the container and its writable layer. Named volumes and bind-mounted folders stay.'

export const containerAction: ActionDefinition<ContainerParams> = {
  type: 'docker.container',
  area: 'docker',
  needs: [DOCKER_PROBE.state, DOCKER_PROBE.containers],
  validate(raw) {
    const input = asObject(raw)
    return { name: containerRef(input.name), op: oneOf(input.op, CONTAINER_OPS, 'Operation') }
  },
  plan(params, facts) {
    const container = findContainer(facts, params.name)
    const blocked = accessBlock(dockerState(facts)) ?? (container ? null : { kind: 'precondition' as const, message: `No container named ${params.name} was found.` })
    return dockerPlan({
      title: `${TITLES[params.op]} ${params.name}`,
      summary: container ? `${params.name} runs ${container.image}. It is ${container.status} now.` : '',
      steps: stepsFor(params, container, facts),
      warnings: params.op === 'remove' ? [REMOVE_WARNING] : [],
      blocked
    })
  }
}
