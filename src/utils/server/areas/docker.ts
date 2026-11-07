import type { AreaModule } from '@/types/server/core'
import { cleanupAction } from '../docker/actions/cleanup'
import { composeAction } from '../docker/actions/compose'
import { containerAction } from '../docker/actions/container'
import { imagePullAction, imageRemoveAction } from '../docker/actions/image'
import { runAction } from '../docker/actions/run'
import { dockerAttention } from '../docker/attention'
import { dockerProbes } from '../docker/probes'

export const dockerArea: AreaModule = {
  id: 'docker',
  probes: dockerProbes,
  actions: [containerAction, composeAction, imagePullAction, imageRemoveAction, cleanupAction, runAction],
  attention: dockerAttention
}
