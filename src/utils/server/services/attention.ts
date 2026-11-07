import type { AttentionItem, ServerFacts } from '@/types/server/core'
import { probeData, serviceId } from './list'
import { isPm2Problem } from './pm2'
import { PROBE } from './probes'
import { isSupervisorProblem } from './supervisor'
import type { Pm2Data, ServiceKind, SupervisorData, SystemdData } from './types'

export const SERVICE_ERROR_RANK = 150

function item(kind: ServiceKind, name: string, user: string | null, title: string, detail: string): AttentionItem {
  const id = serviceId(kind, name, user)
  return { id: `services:${id}`, area: 'services', level: 'error', rank: SERVICE_ERROR_RANK, title, detail, actionLabel: 'Open', route: { section: 'services', params: { id } } }
}

function systemdItems(facts: ServerFacts): AttentionItem[] {
  const data = probeData<SystemdData>(facts, PROBE.systemd)
  if (!data?.installed) return []
  return data.units.filter((unit) => unit.active === 'failed').map((unit) => item('systemd', unit.name, null, `${unit.name} failed`, 'This system service stopped with an error.'))
}

function supervisorItems(facts: ServerFacts): AttentionItem[] {
  const data = probeData<SupervisorData>(facts, PROBE.supervisor)
  if (!data?.installed) return []
  return data.programs
    .filter((program) => isSupervisorProblem(program.state))
    .map((program) => item('supervisor', program.name, null, `${program.name} is ${program.state === 'STOPPED' ? 'stopped' : 'failing'}`, program.state === 'STOPPED' ? 'This Supervisor program is not running.' : 'This Supervisor program keeps exiting.'))
}

function pm2Items(facts: ServerFacts): AttentionItem[] {
  const seen = new Set<string>()
  return [PROBE.pm2, PROBE.pm2Users]
    .map((id) => probeData<Pm2Data>(facts, id))
    .flatMap((data) => (data?.installed ? data.users : []))
    .flatMap((user) => user.apps.filter((app) => isPm2Problem(app.status)).map((app) => item('pm2', app.name, user.user, `${app.name} crashed`, `This pm2 app of ${user.user} is in the errored state.`)))
    .filter((attention) => !seen.has(attention.id) && Boolean(seen.add(attention.id)))
}

export function servicesAttention(facts: ServerFacts): AttentionItem[] {
  return [...systemdItems(facts), ...supervisorItems(facts), ...pm2Items(facts)]
}
