export type DockerAccess = 'root' | 'group' | 'sudo' | 'none'

export interface DockerState {
  installed: boolean
  access: DockerAccess
  sudo: boolean
  clientVersion: string | null
  serverVersion: string | null
  composeVersion: string | null
  serviceActive: boolean
}

export interface PortBinding {
  hostIp: string
  hostPort: number
  containerPort: number
  protocol: string
}

export interface DockerMount {
  type: string
  name: string | null
  source: string
  destination: string
  readOnly: boolean
}

export interface ComposeLabels {
  project: string
  service: string
  workingDir: string
  configFiles: string[]
}

export interface DockerContainer {
  id: string
  name: string
  image: string
  imageId: string
  createdAt: string
  status: string
  exitCode: number
  oomKilled: boolean
  startedAt: string
  finishedAt: string
  health: string | null
  restartPolicy: string
  ports: PortBinding[]
  mounts: DockerMount[]
  networks: string[]
  compose: ComposeLabels | null
}

export interface DockerImage {
  id: string
  repository: string
  tag: string
  createdSince: string
  size: number
  dangling: boolean
  usedBy: number
}

export interface DockerVolume {
  name: string
  driver: string
  mountpoint: string
  dangling: boolean
}

export interface DockerNetwork {
  id: string
  name: string
  driver: string
  scope: string
  internal: boolean
}

export type DiskUsageKind = 'images' | 'containers' | 'volumes' | 'buildCache'

export interface DiskUsageRow {
  total: number
  active: number
  size: number
  reclaimable: number
}

export type DockerDiskUsage = Partial<Record<DiskUsageKind, DiskUsageRow>>

export interface ContainerStats {
  name: string
  cpu: string
  memory: string
}

export interface DockerList<T> {
  items: T[]
  truncated: boolean
}
