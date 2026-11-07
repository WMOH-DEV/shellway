import type { ProbeDefinition } from '@/types/server/core'
import { PACKAGES_SCRIPT, parsePackages } from './packages'
import { PHP_SCRIPT, parsePhp } from './php'
import { PACKAGES_PROBE, PHP_PROBE, UPDATES_PROBE, USAGE_PROBE } from './types'
import { parseUpdates, UPDATES_SCRIPT } from './updates'
import { parseUsage, USAGE_SCRIPT } from './usage'

export const SOFTWARE_PROBES: ProbeDefinition[] = [
  { id: UPDATES_PROBE, area: 'software', root: true, timeoutSeconds: 60, script: UPDATES_SCRIPT, parse: parseUpdates },
  { id: PACKAGES_PROBE, area: 'software', root: false, timeoutSeconds: 30, script: PACKAGES_SCRIPT, parse: parsePackages },
  { id: PHP_PROBE, area: 'software', root: false, timeoutSeconds: 45, script: PHP_SCRIPT, parse: parsePhp },
  { id: USAGE_PROBE, area: 'software', root: true, timeoutSeconds: 20, script: USAGE_SCRIPT, parse: parseUsage }
]
