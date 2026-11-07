import type { OsFamilyOverride } from '../settings/prefs'

export type ProfileId = 'laravel' | 'node' | 'static' | 'docker' | 'custom'

export type RowId = 'web' | 'php' | 'composer' | 'database' | 'redis' | 'node' | 'pm2' | 'supervisor' | 'certbot' | 'docker'

export type SecurityId = 'deployUser' | 'firewall' | 'fail2ban' | 'autoUpdates' | 'swap' | 'passwordLoginOff'

export interface RowChoice {
  on: boolean
  value: string
}

export type RowChoices = Record<RowId, RowChoice>

export type SecurityChoices = Record<SecurityId, boolean>

export interface SetupParams {
  profile: ProfileId
  rows: RowChoices
  security: SecurityChoices
  keyLogin: boolean
  deployUser: string
  osFamily: OsFamilyOverride
}

export interface SetupInventory {
  packages: string[]
  commands: string[]
  clientIp: string | null
  sshPort: number | null
  user: string
  home: string
  memoryBytes: number
  swapBytes: number
  nvm: boolean
  authorizedKeys: number
  installedAt: number | null
  wwwSites: number
}

export interface SetupFiles {
  hashes: Record<string, string>
  fail2banIgnore: string[]
}

export type GroupId = 'update' | 'web' | 'languages' | 'databases' | 'tools' | 'security'
