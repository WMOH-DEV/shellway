import type { AreaModule } from '@/types/server/core'
import { servicesAttention } from '../services/attention'
import { controlAction } from '../services/control'
import { fixAction } from '../services/fix'
import { SERVICES_PROBES } from '../services/probes'

export const servicesArea: AreaModule = {
  id: 'services',
  probes: SERVICES_PROBES,
  actions: [controlAction, fixAction] as AreaModule['actions'],
  attention: servicesAttention
}
