import type { Pm2App, Pm2Facts, SupervisorFacts, SupervisorProcess, SupervisorProgram } from './types'

export type WorkerHealth = 'running' | 'starting' | 'stopped' | 'failing'

export interface WorkerRow {
  key: string
  kind: 'supervisor' | 'pm2'
  name: string
  label: string
  command: string
  directory: string
  user: string
  processes: number
  health: WorkerHealth
  detail: string
  editable: boolean
  firstProcess: string
}

export interface RootCause {
  service: string
  label: string
  state: string
  workers: string[]
  programs: string[]
}

const FAILING = new Set(['FATAL', 'BACKOFF'])
const SERVICE_LABELS: Record<string, string> = { 'redis-server': 'Redis', redis: 'Redis', mysql: 'MySQL', mariadb: 'MariaDB', postgresql: 'PostgreSQL' }

export function workerLabel(command: string, fallback: string): string {
  if (/artisan\s+horizon\b/.test(command)) return 'Horizon'
  if (!/artisan\s+queue:(work|listen)\b/.test(command)) return fallback
  const queue = /--queue[= ]([^\s,]+)/.exec(command)?.[1] ?? 'default'
  return `Queue: ${queue}`
}

export function supervisorUptime(description: string): string {
  const match = /uptime (?:(\d+) days?, )?(\d+):(\d+):\d+/.exec(description)
  if (!match) return ''
  const [, days, hours, minutes] = match
  if (days) return `${days} d`
  if (Number(hours) > 0) return `${Number(hours)} h`
  return `${Number(minutes)} min`
}

export function elapsed(since: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - since) / 60_000))
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} d`
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h`
  return `${minutes} min`
}

function supervisorHealth(processes: SupervisorProcess[]): WorkerHealth {
  if (processes.some((process) => FAILING.has(process.state))) return 'failing'
  if (processes.some((process) => process.state === 'RUNNING')) return 'running'
  if (processes.some((process) => process.state === 'STARTING')) return 'starting'
  return 'stopped'
}

function supervisorDetail(program: SupervisorProgram, health: WorkerHealth): string {
  const { processes } = program
  if (processes.length === 0) return 'Not loaded'
  const failing = processes.find((process) => FAILING.has(process.state))
  if (failing) return failing.state === 'FATAL' ? 'Keeps crashing, gave up' : 'Crashing, restarting'
  if (health === 'starting') return 'Starting'
  if (health === 'stopped') return 'Stopped'
  const running = processes.filter((process) => process.state === 'RUNNING')
  const uptime = supervisorUptime(running[0].description)
  const base = running.length < processes.length ? `${running.length} of ${processes.length} running` : 'Running'
  return uptime ? `${base} ${uptime}` : base
}

function supervisorRow(program: SupervisorProgram): WorkerRow {
  const health = supervisorHealth(program.processes)
  return {
    key: `supervisor:${program.name}`,
    kind: 'supervisor',
    name: program.name,
    label: workerLabel(program.command, program.name),
    command: program.command,
    directory: program.directory,
    user: program.user || 'root',
    processes: Math.max(program.numprocs, program.processes.length),
    health,
    detail: supervisorDetail(program, health),
    editable: program.shellway,
    firstProcess: program.processes[0]?.name ?? program.name
  }
}

const PM2_HEALTH: Record<Pm2App['status'], WorkerHealth> = {
  online: 'running',
  launching: 'starting',
  'one-launch-status': 'starting',
  stopping: 'stopped',
  stopped: 'stopped',
  errored: 'failing',
  unknown: 'stopped'
}

function pm2Detail(app: Pm2App, health: WorkerHealth, now: number): string {
  if (health === 'failing') return app.restarts ? `Crashed, ${app.restarts} restarts` : 'Crashed'
  if (health !== 'running') return health === 'starting' ? 'Starting' : 'Stopped'
  return app.startedAt ? `Running ${elapsed(app.startedAt, now)}` : 'Running'
}

function pm2Row(app: Pm2App, now: number): WorkerRow {
  const health = PM2_HEALTH[app.status]
  return {
    key: `pm2:${app.user}:${app.name}`,
    kind: 'pm2',
    name: app.name,
    label: app.name,
    command: [app.script, app.args].filter(Boolean).join(' '),
    directory: app.cwd,
    user: app.user,
    processes: app.instances,
    health,
    detail: pm2Detail(app, health, now),
    editable: false,
    firstProcess: app.name
  }
}

export function buildWorkerRows(supervisor: SupervisorFacts | null, pm2: Pm2Facts | null, now: number): WorkerRow[] {
  return [...(supervisor?.programs ?? []).map(supervisorRow), ...(pm2?.apps ?? []).map((app) => pm2Row(app, now))]
}

export function queueServices(program: SupervisorProgram, facts: SupervisorFacts): string[] {
  const env = facts.appEnv[program.directory]
  const connection = /artisan\s+horizon\b/.test(program.command) ? 'redis' : /queue:(?:work|listen)\s+([a-z][a-z0-9_]*)/.exec(program.command)?.[1] ?? env?.queue ?? ''
  if (connection === 'redis') return ['redis-server', 'redis']
  if (connection !== 'database') return []
  if (env?.db === 'pgsql') return ['postgresql']
  return env?.db === 'mysql' || env?.db === 'mariadb' ? ['mysql', 'mariadb'] : []
}

const isUp = (active: string): boolean => ['active', 'activating', 'reloading'].includes(active)

function downService(program: SupervisorProgram, facts: SupervisorFacts): string | null {
  const installed = queueServices(program, facts).filter((service) => facts.services[service]?.load === 'loaded')
  if (installed.length === 0 || installed.some((service) => isUp(facts.services[service].active))) return null
  return installed[0]
}

export function workerRootCauses(facts: SupervisorFacts | null): RootCause[] {
  if (!facts) return []
  const causes = new Map<string, RootCause>()
  for (const program of facts.programs) {
    if (supervisorHealth(program.processes) !== 'failing') continue
    const service = downService(program, facts)
    if (!service) continue
    const cause = causes.get(service) ?? { service, label: SERVICE_LABELS[service] ?? service, state: facts.services[service].active, workers: [], programs: [] }
    cause.workers.push(workerLabel(program.command, program.name))
    cause.programs.push(program.name)
    causes.set(service, cause)
  }
  return [...causes.values()]
}

export function rootCauseSentence(cause: RootCause): string {
  const names = cause.workers.length < 3 ? cause.workers.join(' and ') : `${cause.workers.length} workers`
  const verb = cause.workers.length === 1 ? 'keeps' : 'keep'
  const state = cause.state === 'failed' ? 'has failed' : 'is stopped'
  return `${names} ${verb} failing because ${cause.label} ${state}.`
}
