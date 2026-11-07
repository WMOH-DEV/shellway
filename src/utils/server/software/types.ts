import type { ComponentId } from '../install/types'

export const UPDATES_PROBE = 'software.updates'
export const PACKAGES_PROBE = 'software.packages'
export const PHP_PROBE = 'software.php'
export const USAGE_PROBE = 'software.usage'
export const NGINX_PROBE = 'software.nginx'

export interface UpgradePackage {
  name: string
  from: string
  to: string
  security: boolean
}

export type KernelStatus = 'current' | 'pending' | 'unknown'

export interface NeedRestart {
  installed: boolean
  services: string[]
  kernel: KernelStatus
}

export interface UpdatesFacts {
  supported: boolean
  packages: UpgradePackage[]
  held: string[]
  checkedAt: number | null
  serverNow: number | null
  rebootRequired: boolean
  rebootPackages: string[]
  needRestart: NeedRestart
}

export interface InstalledPackage {
  name: string
  version: string
  candidate: string | null
}

export type ServiceState = 'active' | 'inactive' | 'failed' | 'activating' | 'unknown'

export interface NodeFacts {
  version: string | null
  source: 'nodesource' | 'distro' | 'nvm' | 'other' | null
  nvmVersions: string[]
  pm2Version: string | null
}

export interface PackagesFacts {
  supported: boolean
  installed: InstalledPackage[]
  services: Record<string, ServiceState>
  composerVersion: string | null
  certbotSnapVersion: string | null
  node: NodeFacts
  siteCounts: { nginx: number; apache: number }
  listening: string[]
}

export interface PhpIniFile {
  sha256: string | null
  content: string
}

export interface PhpVersionFacts {
  version: string
  fpm: boolean
  fpmState: ServiceState
  cli: boolean
  modules: string[]
  packages: string[]
  available: string[]
  ini: Record<string, string>
  pool: Record<string, string>
  poolFile: PhpIniFile | null
  override: PhpIniFile
}

export interface PhpSite {
  name: string
  version: string
  extensions: string[]
}

export interface PhpFacts {
  installed: boolean
  cliDefault: string | null
  versions: PhpVersionFacts[]
  installable: string[]
  sites: PhpSite[]
}

export interface NginxFacts {
  installed: boolean
  conf: PhpIniFile
  values: Record<string, string>
}

export interface FpmPressure {
  version: string
  hits: number
  last: string | null
}

export interface UsageFacts {
  mysqlDatabases: string[] | null
  postgresDatabases: string[] | null
  fpmPressure: FpmPressure[]
}

export interface PackageHit {
  name: string
  description: string
  installed: boolean
}

export type CatalogGroup = 'web' | 'languages' | 'databases' | 'tools'

export interface CatalogEntry {
  id: string
  name: string
  group: CatalogGroup
  packages: string[]
  glob?: string
  match?: RegExp
  service?: string
  component?: ComponentId
  removable?: boolean
  panel?: string
}
