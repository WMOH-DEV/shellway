import type { ProbeDefinition } from '@/types/server/core'
import { CRONTABS_SCRIPT, parseCrontabs } from './crontabs'
import { parsePm2, PM2_SCRIPT } from './pm2'
import { parseSupervisor, SUPERVISOR_SCRIPT } from './supervisor'
import { parseTimers, TIMERS_SCRIPT } from './timers'
import { CRONTABS_PROBE, PM2_PROBE, SUPERVISOR_PROBE, TIMERS_PROBE, USERS_PROBE } from './types'
import { parseUsers, USERS_SCRIPT } from './users'

export const jobsProbes: ProbeDefinition[] = [
  { id: SUPERVISOR_PROBE, area: 'jobs', root: true, timeoutSeconds: 20, script: SUPERVISOR_SCRIPT, parse: parseSupervisor },
  { id: PM2_PROBE, area: 'jobs', root: false, timeoutSeconds: 30, script: PM2_SCRIPT, parse: parsePm2 },
  { id: CRONTABS_PROBE, area: 'jobs', root: false, timeoutSeconds: 20, script: CRONTABS_SCRIPT, parse: parseCrontabs },
  { id: TIMERS_PROBE, area: 'jobs', root: false, timeoutSeconds: 15, script: TIMERS_SCRIPT, parse: parseTimers },
  { id: USERS_PROBE, area: 'jobs', root: false, timeoutSeconds: 10, script: USERS_SCRIPT, parse: parseUsers }
]
