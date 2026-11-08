import type { AreaModule } from '@/types/server/core'
import { cleanupActions, cleanupProbe } from '../overview/cleanup'
import { diskAttention, diskProbe } from '../overview/disk'
import { foldersProbe } from '../overview/folders'
import { loadProbe, memoryAttention } from '../overview/load'
import { rebootAction, rebootAttention, rebootProbe } from '../overview/reboot'
import { systemProbe } from '../overview/system'

export const overviewArea: AreaModule = {
  id: 'overview',
  probes: [loadProbe, diskProbe, rebootProbe, systemProbe, cleanupProbe, foldersProbe],
  actions: [rebootAction, ...cleanupActions],
  attention: (facts) => [...diskAttention(facts), ...rebootAttention(facts), ...memoryAttention(facts)]
}
