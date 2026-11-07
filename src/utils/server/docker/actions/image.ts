import type { ActionDefinition, PlanBlock } from '@/types/server/core'
import { imageLabel } from '../images'
import { accessBlock, dockerPlan, dockerStep, PULL_TIMEOUT_SECONDS } from '../plan'
import { DOCKER_PROBE, dockerImages, dockerState } from '../probes'
import { shellQuote } from '../shell'
import type { DockerImage } from '../types'
import { asObject, imageReference } from '../validate'

export interface ImageParams {
  image: string
}

const validateImage = (raw: unknown): ImageParams => ({ image: imageReference(asObject(raw).image) })

export const imagePullAction: ActionDefinition<ImageParams> = {
  type: 'docker.image-pull',
  area: 'docker',
  needs: [DOCKER_PROBE.state],
  validate: validateImage,
  plan(params, facts) {
    const state = dockerState(facts)
    return dockerPlan({
      title: `Pull ${params.image}`,
      summary: 'Downloads the image from its registry. Running containers keep their current image until recreated.',
      steps: [dockerStep('pull', 'Pull the image', `docker pull ${shellQuote(params.image)}`, state, { timeoutSeconds: PULL_TIMEOUT_SECONDS, detached: true })],
      blocked: accessBlock(state)
    })
  }
}

const matchesImage = (image: DockerImage, reference: string): boolean => image.id === reference || imageLabel(image) === reference

function removeBlock(image: DockerImage | undefined, reference: string): PlanBlock | null {
  if (!image) return { kind: 'precondition', message: `No image ${reference} was found.` }
  if (image.usedBy > 0) return { kind: 'precondition', message: `${imageLabel(image)} is used by ${image.usedBy} container(s). Remove them first.` }
  return null
}

export const imageRemoveAction: ActionDefinition<ImageParams> = {
  type: 'docker.image-remove',
  area: 'docker',
  needs: [DOCKER_PROBE.state, DOCKER_PROBE.images],
  validate: validateImage,
  plan(params, facts) {
    const state = dockerState(facts)
    const image = dockerImages(facts).find((candidate) => matchesImage(candidate, params.image))
    return dockerPlan({
      title: `Remove image ${params.image}`,
      summary: 'Deletes the image from this server. You can pull it again later.',
      steps: [dockerStep('remove', 'Remove the image', `docker image rm ${shellQuote(params.image)}`, state)],
      blocked: accessBlock(state) ?? removeBlock(image, params.image)
    })
  }
}
