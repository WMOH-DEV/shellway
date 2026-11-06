export type SourceMode = 'auto' | 'pc'
export type DeployLayout = 'releases' | 'inplace'

export interface DeployStep {
  command: string
  optional: boolean
}

export interface SiteConfig {
  name: string
  path: string
  repoUrl: string
  branch: string
  sourceMode: SourceMode
  layout: DeployLayout
  sharedPaths: string[]
  envFile: string
  healthUrl: string
  healthStatus: number
  autoRevert: boolean
  keepReleases: number
  pollMinutes: number
  approveMigrations: boolean
  migrationsPath: string
  pcAuto: boolean
  buildSteps: DeployStep[]
  activateSteps: DeployStep[]
}

export type DeployStatus = 'running' | 'success' | 'warning' | 'failed' | 'waiting' | 'reverted' | 'cancelled'
export type DeployStage = 'fetch' | 'build' | 'activate' | 'health'

export interface DeployProgress {
  stage: DeployStage
  step: number
  steps: number
  command: string
}

export interface DeployRecord {
  id: string
  status: DeployStatus
  trigger: string
  commit: string
  started: number
  finished: number | null
  warnings: number
  note: string
}

export interface SiteState {
  current: string
  currentRelease: string
  lastAttempted: string
  remoteHead: string
  heartbeat: number | null
  mirrorHead: string
  pending: string
  behind: number | null
  busy: boolean
  currentSubject: string
  progress: DeployProgress | null
  cancelling: boolean
  now: number
}

export interface RemoteDrift {
  head: string
  behind: number | null
}

export interface SiteSummary {
  config: SiteConfig
  state: SiteState
  history: DeployRecord[]
}

export type SitePathKind = 'missing' | 'dir' | 'symlink' | 'foreign-symlink' | 'file'

export interface DoctorReport {
  user: string
  git: boolean
  curl: boolean
  wget: boolean
  crontab: boolean
  sshKeygen: boolean
  sitePathKind: SitePathKind
  parentWritable: boolean
  siteWritable: boolean
  deployKey: boolean
  sudoOk: string[]
  sudoNeeds: string[]
}

export interface DetectResult {
  exists: boolean
  repoUrl: string
  branch: string
  files: string[]
  buildScript: boolean
}

export interface RunnerInfo {
  installed: boolean
  version: number | null
  bundledVersion: number
}

export interface DeployResult<T = undefined> {
  success: boolean
  data?: T
  error?: string
}
