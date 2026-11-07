import type { AreaModule } from '@/types/server/core'
import { identityProbe } from '../core/identity'
import { sudoProbe } from '../core/sudo'

export const coreArea: AreaModule = {
  id: 'core',
  probes: [identityProbe, sudoProbe],
  actions: [],
  attention: () => []
}
