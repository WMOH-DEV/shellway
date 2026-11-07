import type { AreaModule } from '@/types/server/core'

export const dockerArea: AreaModule = {
  id: 'docker',
  probes: [],
  actions: [],
  attention: () => []
}
