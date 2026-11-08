import type { AreaModule } from '@/types/server/core'
import { SITES_ACTIONS } from '../sites/actions'
import { inventoryProbe } from '../sites/inventory'

export const sitesArea: AreaModule = {
  id: 'sites',
  probes: [inventoryProbe],
  actions: SITES_ACTIONS,
  attention: () => []
}
