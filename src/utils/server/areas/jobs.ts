import type { ActionDefinition, AreaModule } from '@/types/server/core'
import { jobsAttention } from '../jobs/attention'
import { cronRemoveAction, cronRunNowAction, cronSaveAction } from '../jobs/cronActions'
import { jobsProbes } from '../jobs/probes'
import { pm2ControlAction, workerControlAction, workerRemoveAction, workerSaveAction } from '../jobs/workerActions'

export const jobsArea: AreaModule = {
  id: 'jobs',
  probes: jobsProbes,
  actions: [workerSaveAction, workerRemoveAction, workerControlAction, pm2ControlAction, cronSaveAction, cronRemoveAction, cronRunNowAction] as ActionDefinition[],
  attention: jobsAttention
}
