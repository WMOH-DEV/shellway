import type { AttentionItem, ServerFacts } from '@/types/server/core'
import { formatBinding, isCrashed, publicBindings } from './exposure'
import { dockerContainers } from './probes'
import type { DockerContainer } from './types'

export const CRASHED_RANK = 140
export const EXPOSED_RANK = 80

function crashedItem(container: DockerContainer): AttentionItem {
  return {
    id: `docker.crashed.${container.name}`,
    area: 'docker',
    level: 'error',
    rank: CRASHED_RANK,
    title: `Container ${container.name} stopped with an error`,
    detail: `It exited with code ${container.exitCode}${container.oomKilled ? ' (out of memory)' : ''} and is set to restart ${container.restartPolicy}, but it is not running.`,
    actionLabel: 'View logs',
    route: { section: 'docker', params: { container: container.name } }
  }
}

function exposureItem(exposed: DockerContainer[]): AttentionItem {
  const ports = exposed.map((container) => `${container.name} (${publicBindings(container).map(formatBinding)[0]})`)
  return {
    id: 'docker.public-ports',
    area: 'docker',
    level: 'warning',
    rank: EXPOSED_RANK,
    title: exposed.length === 1 ? 'A container is open to the internet' : `${exposed.length} containers are open to the internet`,
    detail: `Docker skips the ufw firewall for published ports: ${ports.join(', ')}.`,
    actionLabel: 'Review',
    route: { section: 'docker' }
  }
}

export function dockerAttention(facts: ServerFacts): AttentionItem[] {
  const containers = dockerContainers(facts)
  const exposed = containers.filter((container) => container.status === 'running' && publicBindings(container).length > 0)
  return [...containers.filter(isCrashed).map(crashedItem), ...(exposed.length > 0 ? [exposureItem(exposed)] : [])]
}
