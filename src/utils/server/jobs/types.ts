export const SUPERVISOR_PROBE = 'jobs.supervisor'
export const PM2_PROBE = 'jobs.pm2'
export const CRONTABS_PROBE = 'jobs.crontabs'
export const TIMERS_PROBE = 'jobs.timers'
export const USERS_PROBE = 'jobs.users'

export const JOBS_PROBES = [SUPERVISOR_PROBE, PM2_PROBE, CRONTABS_PROBE, TIMERS_PROBE, USERS_PROBE] as const

export type SupervisorState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'BACKOFF' | 'STOPPING' | 'EXITED' | 'FATAL' | 'UNKNOWN'

export interface SupervisorProcess {
  name: string
  state: SupervisorState
  description: string
}

export interface SupervisorProgram {
  name: string
  file: string | null
  command: string
  directory: string
  user: string
  numprocs: number
  autostart: boolean
  stdoutLogfile: string
  shellway: boolean
  processes: SupervisorProcess[]
}

export interface ConfFile {
  path: string
  sha256: string
  content: string
}

export interface ServiceState {
  load: string
  active: string
}

export interface AppEnv {
  queue: string
  db: string
}

export interface SupervisorFacts {
  installed: boolean
  running: boolean
  programs: SupervisorProgram[]
  files: ConfFile[]
  services: Record<string, ServiceState>
  appEnv: Record<string, AppEnv>
}

export type Pm2Status = 'online' | 'stopping' | 'stopped' | 'launching' | 'errored' | 'one-launch-status' | 'unknown'

export interface Pm2App {
  user: string
  name: string
  status: Pm2Status
  instances: number
  restarts: number
  startedAt: number | null
  cwd: string
  script: string
  args: string
}

export interface Pm2Facts {
  installed: boolean
  users: string[]
  apps: Pm2App[]
}

export interface LastRun {
  exitCode: number
  at: number
}

export interface ShellwayTask {
  id: string
  logOutput: boolean
}

export interface CronEntry {
  ref: string
  user: string
  source: string
  line: number
  expression: string
  command: string
  shellway: ShellwayTask | null
  lastRun: LastRun | null
}

export interface UserCrontab {
  user: string
  sha256: string
  text: string
  entries: CronEntry[]
}

export interface CrontabFacts {
  installed: boolean
  self: string
  readsOthers: boolean
  crontabs: UserCrontab[]
  system: CronEntry[]
}

export interface SystemdTimer {
  unit: string
  description: string
  activates: string
  next: string
  last: string
  active: string
}

export interface TimersFacts {
  available: boolean
  timers: SystemdTimer[]
}

export interface ServerUser {
  name: string
  uid: number
  home: string
}

export interface UsersFacts {
  self: string
  sudo: boolean
  users: ServerUser[]
}
