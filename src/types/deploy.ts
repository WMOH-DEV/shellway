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
  subject: string
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
  remoteSubject: string
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

export type ShipFileStatus = 'A' | 'M' | 'D' | 'R'

export interface ShipCommit {
  sha: string
  subject: string
  author: string
  time: number
  migration: boolean
}

export interface ShipFile {
  status: ShipFileStatus
  path: string
  added: number | null
  removed: number | null
  migration: boolean
}

export interface ShipPreview {
  from: string
  to: string
  branch: string
  commits: ShipCommit[]
  files: ShipFile[]
  totalCommits: number
  totalFiles: number
  truncated: boolean
}

export interface DeployResult<T = undefined> {
  success: boolean
  data?: T
  error?: string
}
