import type { ActionDefinition, ActionStep, ServerFacts } from '@/types/server/core'
import { imageLabel } from '../images'
import { accessBlock, dockerPlan, dockerStep } from '../plan'
import { DOCKER_PROBE, dockerContainers, dockerDiskUsage, dockerImages, dockerState, dockerVolumes } from '../probes'
import { formatSize } from '../size'
import { majorVersion } from '../state'
import type { DockerContainer, DockerState } from '../types'
import { asObject, fail, oneOf } from '../validate'

export const IMAGE_MODES = ['none', 'dangling', 'unused'] as const
export type ImageMode = (typeof IMAGE_MODES)[number]

export interface CleanupParams {
  containers: boolean
  images: ImageMode
  volumes: boolean
  buildCache: boolean
}

export interface CleanupGroup {
  key: 'containers' | 'images' | 'volumes' | 'buildCache'
  label: string
  names: string[]
  bytes: number
}

const STOPPED = new Set(['exited', 'created', 'dead'])

const isStopped = (container: DockerContainer): boolean => STOPPED.has(container.status)

function remainingContainers(facts: ServerFacts, params: CleanupParams): DockerContainer[] {
  const all = dockerContainers(facts)
  return params.containers ? all.filter((container) => !isStopped(container)) : all
}

function containerGroup(facts: ServerFacts): CleanupGroup {
  const names = dockerContainers(facts).filter(isStopped).map((container) => container.name)
  return { key: 'containers', label: 'Stopped containers', names, bytes: dockerDiskUsage(facts).containers?.reclaimable ?? 0 }
}

function imageGroup(facts: ServerFacts, params: CleanupParams, remaining: DockerContainer[]): CleanupGroup {
  const used = new Set(remaining.map((container) => container.imageId))
  const images = dockerImages(facts).filter((image) => !used.has(image.id) && (params.images === 'unused' || image.dangling))
  const label = params.images === 'unused' ? 'Images not used by any container' : 'Untagged (dangling) images'
  return { key: 'images', label, names: images.map(imageLabel), bytes: images.reduce((total, image) => total + image.size, 0) }
}

function volumeGroup(facts: ServerFacts, remaining: DockerContainer[]): CleanupGroup {
  const used = new Set(remaining.flatMap((container) => container.mounts.filter((mount) => mount.type === 'volume' && mount.name).map((mount) => mount.name as string)))
  const names = dockerVolumes(facts).filter((volume) => !used.has(volume.name)).map((volume) => volume.name)
  return { key: 'volumes', label: 'Unused volumes', names, bytes: dockerDiskUsage(facts).volumes?.reclaimable ?? 0 }
}

function buildCacheGroup(facts: ServerFacts): CleanupGroup {
  return { key: 'buildCache', label: 'Build cache', names: [], bytes: dockerDiskUsage(facts).buildCache?.reclaimable ?? 0 }
}

export function cleanupGroups(facts: ServerFacts, params: CleanupParams): CleanupGroup[] {
  const remaining = remainingContainers(facts, params)
  return [
    ...(params.containers ? [containerGroup(facts)] : []),
    ...(params.images !== 'none' ? [imageGroup(facts, params, remaining)] : []),
    ...(params.volumes ? [volumeGroup(facts, remaining)] : []),
    ...(params.buildCache ? [buildCacheGroup(facts)] : [])
  ]
}

export interface PruneCommand {
  label: string
  command: string
}

export function cleanupCommands(params: CleanupParams, state: DockerState | null): PruneCommand[] {
  const allVolumes = majorVersion(state?.serverVersion ?? null) >= 23 ? ' -a' : ''
  return [
    ...(params.containers ? [{ label: 'Remove stopped containers', command: 'docker container prune -f' }] : []),
    ...(params.images === 'dangling' ? [{ label: 'Remove untagged images', command: 'docker image prune -f' }] : []),
    ...(params.images === 'unused' ? [{ label: 'Remove unused images', command: 'docker image prune -a -f' }] : []),
    ...(params.volumes ? [{ label: 'Remove unused volumes', command: `docker volume prune${allVolumes} -f` }] : []),
    ...(params.buildCache ? [{ label: 'Remove build cache', command: 'docker builder prune -a -f' }] : [])
  ]
}

const NAME_PREVIEW = 8

function describeGroup(group: CleanupGroup): string {
  const count = group.key === 'buildCache' ? '' : ` (${group.names.length})`
  const shown = group.names.slice(0, NAME_PREVIEW).join(', ')
  const more = group.names.length > NAME_PREVIEW ? ` and ${group.names.length - NAME_PREVIEW} more` : ''
  return `${group.label}${count}, ${formatSize(group.bytes)}${shown ? `: ${shown}${more}` : ''}`
}

const VOLUME_WARNING = 'Unused volumes are deleted for good, with all the data in them. This cannot be undone.'
const UNUSED_IMAGES_WARNING = 'Every image no container uses is removed. You can pull them again later.'

function warningsFor(params: CleanupParams): string[] {
  return [...(params.volumes ? [VOLUME_WARNING] : []), ...(params.images === 'unused' ? [UNUSED_IMAGES_WARNING] : [])]
}

function stepsFor(params: CleanupParams, state: DockerState | null): ActionStep[] {
  return cleanupCommands(params, state).map(({ label, command }, index) => dockerStep(`prune-${index + 1}`, label, command, state, { timeoutSeconds: 600 }))
}

export const cleanupAction: ActionDefinition<CleanupParams> = {
  type: 'docker.cleanup',
  area: 'docker',
  needs: [DOCKER_PROBE.state, DOCKER_PROBE.containers, DOCKER_PROBE.images, DOCKER_PROBE.volumes, DOCKER_PROBE.df],
  validate(raw) {
    const input = asObject(raw)
    const params = {
      containers: input.containers === true,
      images: oneOf(input.images ?? 'none', IMAGE_MODES, 'Images'),
      volumes: input.volumes === true,
      buildCache: input.buildCache === true
    }
    if (!params.containers && params.images === 'none' && !params.volumes && !params.buildCache) fail('Pick at least one thing to clean up')
    return params
  },
  plan(params, facts) {
    const state = dockerState(facts)
    return dockerPlan({
      title: 'Clean up unused Docker data',
      summary: cleanupGroups(facts, params).map(describeGroup).join('\n'),
      steps: stepsFor(params, state),
      warnings: warningsFor(params),
      blocked: accessBlock(state)
    })
  }
}
