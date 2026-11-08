import type { ServerFacts } from '@/types/server/core'
import { formatDuration } from './format'
import { PROBE } from './probes'
import type { Container, ContainersData, Pm2App, Pm2Data, ServiceKind, ServiceState, SupervisorData, SupervisorProgram, SystemdData, SystemdUnit } from './types'

export type ControlVerb = 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable' | 'reset-failed'

export interface ServiceItem {
  id: string
  kind: ServiceKind
  name: string
  user: string | null
  detail: string
  state: ServiceState
  statusText: string
  cpuPercent: number | null
  memoryBytes: number | null
  onBoot: boolean | null
  verbs: ControlVerb[]
}

export function probeData<T>(facts: ServerFacts, id: string): T | null {
  const result = facts[id]
  return result?.status === 'ok' ? (result.data as T) : null
}

export const serviceId = (kind: ServiceKind, name: string, user: string | null = null): string => (user ? `${kind}:${user}:${name}` : `${kind}:${name}`)

const RELOADABLE = /^(nginx|apache2|httpd|caddy|haproxy|varnish|php[\d.]*-fpm)$/

const since = (seconds: number | null): string => (seconds === null ? '' : ` ${formatDuration(seconds)}`)

function systemdState(unit: SystemdUnit): ServiceState {
  if (unit.active === 'failed') return 'failed'
  if (unit.active === 'active') return 'running'
  if (unit.active === 'activating' || unit.active === 'reloading' || unit.active === 'deactivating') return 'starting'
  return 'stopped'
}

function systemdStatus(unit: SystemdUnit, state: ServiceState): string {
  if (state === 'failed') return unit.sinceSeconds === null ? 'failed' : `failed ${formatDuration(unit.sinceSeconds)} ago`
  if (state === 'running') return unit.sub === 'running' ? `running${since(unit.sinceSeconds)}` : `active (${unit.sub})`
  return state === 'starting' ? unit.active : 'stopped'
}

function runningVerbs(reloadable: boolean): ControlVerb[] {
  return reloadable ? ['reload', 'restart', 'stop'] : ['restart', 'stop']
}

function stoppedVerbs(state: ServiceState, oneshot: boolean): ControlVerb[] {
  return state === 'failed' && oneshot ? ['reset-failed', 'start'] : ['start']
}

function systemdItem(unit: SystemdUnit): ServiceItem {
  const state = systemdState(unit)
  const verbs = state === 'running' ? runningVerbs(RELOADABLE.test(unit.name)) : stoppedVerbs(state, unit.oneshot === true)
  const bootVerbs: ControlVerb[] = unit.enabled === null ? [] : [unit.enabled ? 'disable' : 'enable']
  return {
    id: serviceId('systemd', unit.name),
    kind: 'systemd',
    name: unit.name,
    user: null,
    detail: unit.description,
    state,
    statusText: systemdStatus(unit, state),
    cpuPercent: unit.cpuPercent,
    memoryBytes: unit.memoryBytes,
    onBoot: unit.enabled,
    verbs: [...verbs, ...bootVerbs]
  }
}

const SUPERVISOR_STATES: Record<string, ServiceState> = { RUNNING: 'running', STARTING: 'starting', STOPPING: 'starting', BACKOFF: 'failed', FATAL: 'failed' }

function supervisorItem(program: SupervisorProgram): ServiceItem {
  const state = SUPERVISOR_STATES[program.state] ?? 'stopped'
  const statusText = state === 'running' ? `running${program.uptime ? ` ${program.uptime}` : ''}` : state === 'failed' ? `failed (${program.state.toLowerCase()})` : program.state.toLowerCase()
  return {
    id: serviceId('supervisor', program.name),
    kind: 'supervisor',
    name: program.name,
    user: null,
    detail: state === 'running' ? '' : program.description,
    state,
    statusText,
    cpuPercent: program.cpuPercent,
    memoryBytes: program.memoryBytes,
    onBoot: null,
    verbs: state === 'running' ? ['restart', 'stop'] : ['start']
  }
}

const PM2_STATES: Record<string, ServiceState> = { online: 'running', launching: 'starting', 'waiting restart': 'starting', errored: 'failed' }

function pm2Item(app: Pm2App, user: string, startup: boolean): ServiceItem {
  const state = PM2_STATES[app.status] ?? 'stopped'
  const restarts = app.restarts > 0 ? ` · ${app.restarts} restarts` : ''
  return {
    id: serviceId('pm2', app.name, user),
    kind: 'pm2',
    name: app.name,
    user,
    detail: `${app.script || 'pm2 app'} · ${user}${app.instances > 1 ? ` · ${app.instances} instances` : ''}${restarts}`,
    state,
    statusText: state === 'running' ? `running${since(app.sinceSeconds)}` : app.status,
    cpuPercent: app.cpuPercent,
    memoryBytes: app.memoryBytes,
    onBoot: startup,
    verbs: state === 'running' ? ['restart', 'stop'] : ['start', 'restart']
  }
}

function containerState(container: Container): ServiceState {
  if (container.state === 'running') return 'running'
  if (container.state === 'restarting' || container.state === 'dead') return 'failed'
  if (container.state === 'exited' && !/^Exited \(0\)/.test(container.status)) return 'failed'
  return 'stopped'
}

function containerItem(container: Container): ServiceItem {
  const state = containerState(container)
  const policy = container.restartPolicy
  return {
    id: serviceId('container', container.name),
    kind: 'container',
    name: container.name,
    user: null,
    detail: [container.image, container.project && `stack ${container.project}`].filter(Boolean).join(' · '),
    state,
    statusText: container.status.replace(/^Up /, 'running ').toLowerCase(),
    cpuPercent: container.cpuPercent,
    memoryBytes: container.memoryBytes,
    onBoot: policy ? policy !== 'no' : null,
    verbs: state === 'running' ? ['restart', 'stop'] : ['start']
  }
}

function pm2Items(...sources: (Pm2Data | null)[]): ServiceItem[] {
  const seen = new Set<string>()
  return sources.flatMap((data) => (data?.installed ? data.users : [])).flatMap((user) => {
    if (seen.has(user.user)) return []
    seen.add(user.user)
    return user.apps.map((app) => pm2Item(app, user.user, user.startup))
  })
}

const STATE_ORDER: Record<ServiceState, number> = { failed: 0, starting: 1, running: 2, stopped: 3 }
const KIND_ORDER: Record<ServiceKind, number> = { systemd: 0, supervisor: 1, pm2: 2, container: 3 }

function compareItems(a: ServiceItem, b: ServiceItem): number {
  const failed = Number(b.state === 'failed') - Number(a.state === 'failed')
  return failed || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name)
}

export function buildServiceList(facts: ServerFacts): ServiceItem[] {
  const systemd = probeData<SystemdData>(facts, PROBE.systemd)
  const supervisor = probeData<SupervisorData>(facts, PROBE.supervisor)
  const containers = probeData<ContainersData>(facts, PROBE.containers)
  return [
    ...(systemd?.installed ? systemd.units.map(systemdItem) : []),
    ...(supervisor?.installed ? supervisor.programs.map(supervisorItem) : []),
    ...pm2Items(probeData<Pm2Data>(facts, PROBE.pm2), probeData<Pm2Data>(facts, PROBE.pm2Users)),
    ...(containers?.installed ? containers.containers.map(containerItem) : [])
  ].sort(compareItems)
}

export type ServiceFilter = 'all' | 'failed' | ServiceKind

export const SERVICE_FILTERS: readonly ServiceFilter[] = ['all', 'failed', 'systemd', 'supervisor', 'pm2', 'container']

function matchesFilter(item: ServiceItem, filter: ServiceFilter): boolean {
  if (filter === 'all') return true
  return filter === 'failed' ? item.state === 'failed' : item.kind === filter
}

function matchesQuery(item: ServiceItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || `${item.name} ${item.detail} ${item.user ?? ''}`.toLowerCase().includes(needle)
}

export function filterServices(items: ServiceItem[], filter: ServiceFilter, query: string): ServiceItem[] {
  return items.filter((item) => matchesFilter(item, filter) && matchesQuery(item, query))
}

export function filterCounts(items: ServiceItem[]): Record<ServiceFilter, number> {
  return Object.fromEntries(SERVICE_FILTERS.map((filter) => [filter, items.filter((item) => matchesFilter(item, filter)).length])) as Record<ServiceFilter, number>
}

export function primaryVerb(item: ServiceItem): ControlVerb {
  if (item.verbs.includes('reset-failed')) return 'reset-failed'
  if (item.state !== 'running') return 'start'
  return item.verbs.includes('reload') && /^(nginx|apache2|httpd|caddy)$/.test(item.name) ? 'reload' : 'restart'
}
