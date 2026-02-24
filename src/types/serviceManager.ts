/** Systemd unit info from `systemctl list-units` */
export interface SystemdService {
  unit: string           // e.g. "nginx.service"
  load: 'loaded' | 'not-found' | 'masked' | 'error' | string
  active: 'active' | 'inactive' | 'failed' | 'activating' | 'deactivating' | string
  sub: 'running' | 'dead' | 'exited' | 'failed' | 'waiting' | 'listening' | string
  description: string
}

/** Extended service details from `systemctl show` */
export interface ServiceDetails {
  unit: string
  description: string
  loadState: string
  activeState: string
  subState: string
  unitFileState: string      // enabled, disabled, static, masked
  fragmentPath: string       // path to the unit file
  mainPID: number
  execMainStartTimestamp: string
  activeEnterTimestamp: string
  inactiveEnterTimestamp: string
  memoryCurrentBytes?: number
  cpuUsageNSec?: number
  tasksCurrent?: number
  restartCount?: number
  type?: string              // simple, forking, oneshot, etc.
  requires?: string[]
  wantedBy?: string[]
  after?: string[]
  before?: string[]
}

/** A single log entry from journalctl */
export interface ServiceLogEntry {
  timestamp: string
  priority: 'emerg' | 'alert' | 'crit' | 'err' | 'warning' | 'notice' | 'info' | 'debug' | string
  message: string
  unit?: string
}

/** Service action types */
export type ServiceAction = 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable' | 'mask' | 'unmask'

/** Service Manager connection status */
export type ServiceManagerStatus = 'idle' | 'loading' | 'active' | 'error' | 'unsupported'

/** Filter/sort state for the service list */
export interface ServiceFilter {
  search: string
  activeFilter: 'all' | 'active' | 'inactive' | 'failed'
  loadFilter: 'all' | 'loaded' | 'not-found' | 'masked'
  sortBy: 'name' | 'active' | 'sub' | 'description'
  sortDir: 'asc' | 'desc'
}
