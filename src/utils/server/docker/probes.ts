import type { ProbeDefinition, ServerFacts } from '@/types/server/core'
import { CONTAINERS_SCRIPT, parseContainers } from './containers'
import { IMAGES_SCRIPT, parseImages } from './images'
import { DF_SCRIPT, NETWORKS_SCRIPT, STATS_SCRIPT, VOLUMES_SCRIPT, parseDiskUsage, parseNetworks, parseStats, parseVolumes } from './resources'
import { STATE_SCRIPT, parseDockerState } from './state'
import type { ContainerStats, DockerContainer, DockerDiskUsage, DockerImage, DockerList, DockerNetwork, DockerState, DockerVolume } from './types'

export const DOCKER_PROBE = {
  state: 'docker.state',
  containers: 'docker.containers',
  images: 'docker.images',
  volumes: 'docker.volumes',
  networks: 'docker.networks',
  df: 'docker.df',
  stats: 'docker.stats'
} as const

const probe = <T>(id: string, timeoutSeconds: number, script: string, parse: (stdout: string) => T): ProbeDefinition<T> => ({
  id,
  area: 'docker',
  root: false,
  timeoutSeconds,
  script,
  parse
})

export const dockerProbes = [
  probe<DockerState>(DOCKER_PROBE.state, 15, STATE_SCRIPT, parseDockerState),
  probe<DockerList<DockerContainer>>(DOCKER_PROBE.containers, 25, CONTAINERS_SCRIPT, parseContainers),
  probe<DockerImage[]>(DOCKER_PROBE.images, 25, IMAGES_SCRIPT, parseImages),
  probe<DockerVolume[]>(DOCKER_PROBE.volumes, 15, VOLUMES_SCRIPT, parseVolumes),
  probe<DockerNetwork[]>(DOCKER_PROBE.networks, 15, NETWORKS_SCRIPT, parseNetworks),
  probe<DockerDiskUsage>(DOCKER_PROBE.df, 40, DF_SCRIPT, parseDiskUsage),
  probe<ContainerStats[]>(DOCKER_PROBE.stats, 20, STATS_SCRIPT, parseStats)
]

export function factData<T>(facts: ServerFacts, id: string): T | null {
  const result = facts[id]
  return result?.status === 'ok' ? (result.data as T) : null
}

export const dockerState = (facts: ServerFacts): DockerState | null => factData<DockerState>(facts, DOCKER_PROBE.state)

export const dockerContainers = (facts: ServerFacts): DockerContainer[] => factData<DockerList<DockerContainer>>(facts, DOCKER_PROBE.containers)?.items ?? []

export const dockerImages = (facts: ServerFacts): DockerImage[] => factData<DockerImage[]>(facts, DOCKER_PROBE.images) ?? []

export const dockerVolumes = (facts: ServerFacts): DockerVolume[] => factData<DockerVolume[]>(facts, DOCKER_PROBE.volumes) ?? []

export const dockerDiskUsage = (facts: ServerFacts): DockerDiskUsage => factData<DockerDiskUsage>(facts, DOCKER_PROBE.df) ?? {}
