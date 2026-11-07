import type { ProbeDefinition } from '@/types/server/core'
import { CONTAINERS_SCRIPT, parseContainers } from './containers'
import { FAILED_SCRIPT, parseFailed } from './failed'
import { parsePm2, PM2_SCRIPT, PM2_USERS_SCRIPT } from './pm2'
import { parseSupervisor, SUPERVISOR_SCRIPT } from './supervisor'
import { parseSystemd, SYSTEMD_SCRIPT } from './systemd'
import type { ContainersData, FailedDetails, Pm2Data, SiteUsage, SupervisorData, SystemdData } from './types'
import { parseUsage, USAGE_SCRIPT } from './usage'

export const PROBE = {
  systemd: 'services.systemd',
  supervisor: 'services.supervisor',
  pm2: 'services.pm2',
  pm2Users: 'services.pm2users',
  containers: 'services.containers',
  failed: 'services.failed',
  usage: 'services.usage'
} as const

export const systemdProbe: ProbeDefinition<SystemdData> = { id: PROBE.systemd, area: 'services', root: false, timeoutSeconds: 20, script: SYSTEMD_SCRIPT, parse: parseSystemd }

export const supervisorProbe: ProbeDefinition<SupervisorData> = { id: PROBE.supervisor, area: 'services', root: true, timeoutSeconds: 15, script: SUPERVISOR_SCRIPT, parse: parseSupervisor }

export const pm2Probe: ProbeDefinition<Pm2Data> = { id: PROBE.pm2, area: 'services', root: false, timeoutSeconds: 25, script: PM2_SCRIPT, parse: parsePm2 }

export const pm2UsersProbe: ProbeDefinition<Pm2Data> = { id: PROBE.pm2Users, area: 'services', root: true, timeoutSeconds: 90, script: PM2_USERS_SCRIPT, parse: parsePm2 }

export const containersProbe: ProbeDefinition<ContainersData> = { id: PROBE.containers, area: 'services', root: false, timeoutSeconds: 30, script: CONTAINERS_SCRIPT, parse: parseContainers }

export const failedProbe: ProbeDefinition<FailedDetails> = { id: PROBE.failed, area: 'services', root: true, timeoutSeconds: 30, script: FAILED_SCRIPT, parse: parseFailed }

export const usageProbe: ProbeDefinition<SiteUsage> = { id: PROBE.usage, area: 'services', root: false, timeoutSeconds: 10, script: USAGE_SCRIPT, parse: parseUsage }

export const SERVICES_PROBES: ProbeDefinition[] = [systemdProbe, supervisorProbe, pm2Probe, pm2UsersProbe, containersProbe, failedProbe, usageProbe] as ProbeDefinition[]

export const LIST_PROBE_IDS: readonly string[] = SERVICES_PROBES.map((probe) => probe.id)
