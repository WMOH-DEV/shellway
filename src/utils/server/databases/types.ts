export type DbEngine = 'mysql' | 'postgresql'

export type DbFlavor = 'mysql' | 'mariadb' | 'postgresql'

export type EngineStatus = 'missing' | 'stopped' | 'no-access' | 'ok'

export interface DbDatabase {
  name: string
  sizeBytes: number
  tables: number | null
  owner: string | null
  system: boolean
}

export interface DbUser {
  name: string
  host: string | null
  grants: string[]
  socketLogin: boolean
  superuser: boolean
}

export interface SignInFix {
  name: string
  label: string
  code: string
}

export interface EngineFacts {
  engine: DbEngine
  status: EngineStatus
  reason: string
  signInFixes?: SignInFix[]
  flavor: DbFlavor
  version: string
  listen: string[]
  databases: DbDatabase[]
  users: DbUser[]
}

export type RedisStatus = 'missing' | 'stopped' | 'needs-password' | 'ok'

export interface RedisKeyspace {
  db: string
  keys: number
  expires: number
}

export interface RedisFacts {
  status: RedisStatus
  reason: string
  version: string
  port: number | null
  uptimeSeconds: number
  usedMemory: string
  maxMemory: string
  clients: number
  keyspace: RedisKeyspace[]
}

export interface BackupFile {
  path: string
  engine: DbEngine
  database: string
  sizeBytes: number
  modifiedAt: number
}

export interface BackupSchedule {
  hour: number
  minute: number
  keepDays: number
}

export interface BackupLastResult {
  ok: boolean
  at: number
  saved: number
  failed: number
  note: string
}

export interface BackupFacts {
  schedule: BackupSchedule | null
  cronContent: string | null
  cronSha256: string | null
  scriptSha256: string | null
  last: BackupLastResult | null
  files: BackupFile[]
}

export interface SiteDbSettings {
  connection: string
  database: string
  username: string
}

export interface SiteEnv {
  site: string
  path: string
  readable: boolean
  owner: string
  mode: string
  sha256: string
  content: string
  db: SiteDbSettings
}

export interface SiteEnvFacts {
  deployInstalled: boolean
  sites: SiteEnv[]
}
