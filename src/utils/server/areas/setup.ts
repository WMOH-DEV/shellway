import type { AreaModule } from '@/types/server/core'

export const setupArea: AreaModule = {
  id: 'setup',
  probes: [],
  actions: [],
  attention: () => []
}
