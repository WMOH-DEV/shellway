export type ServiceKind = 'systemd' | 'supervisor' | 'pm2' | 'container'

export type ServiceState = 'running' | 'starting' | 'stopped' | 'failed'

export interface SystemdUnit {
  name: string
  description: string
  load: string
  active: string
  sub: string
  enabled: boolean | null
  cpuPercent: number | null
  memoryBytes: number | null
  sinceSeconds: number | null
}

export type ToolData<T> = { installed: false } | ({ installed: true } & T)

export type SystemdData = ToolData<{ units: SystemdUnit[] }>

export interface SupervisorProgram {
  name: string
  state: string
  pid: number | null
  uptime: string
  description: string
  cpuPercent: number | null
  memoryBytes: number | null
}

export type SupervisorData = ToolData<{ running: boolean; programs: SupervisorProgram[] }>

export interface Pm2App {
  name: string
  id: number
  status: string
  restarts: number
  cpuPercent: number | null
  memoryBytes: number | null
  sinceSeconds: number | null
  script: string
  instances: number
}

export interface Pm2User {
  user: string
  running: boolean
  startup: boolean
  apps: Pm2App[]
}

export type Pm2Data = ToolData<{ users: Pm2User[] }>

export type DockerAccess = 'direct' | 'sudo'

export interface Container {
  id: string
  name: string
  image: string
  state: string
  status: string
  project: string
  restartPolicy: string
  cpuPercent: number | null
  memoryBytes: number | null
}

export type ContainersData = { installed: false } | { installed: true; access: DockerAccess | null; containers: Container[] }

export interface Listener {
  address: string
  port: number
  process: string
}

export interface FailedDetails {
  units: Record<string, string[]>
  programs: Record<string, string[]>
  nginxTest: string | null
  apacheTest: string | null
  listeners: Listener[]
}

export interface SiteUsage {
  nginx: string[]
  apache: string[]
  php: Record<string, string[]>
}
