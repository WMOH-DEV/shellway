export type OsFamily = 'ubuntu' | 'debian' | 'rhel' | 'other'

export interface OsInfo {
  family: OsFamily
  id: string
  versionId: string
  codename: string
  prettyName: string
}

export interface ServerIdentity {
  hostname: string
  os: OsInfo
  kernel: string
  arch: string
  virtualization: string
  cpus: number
  memoryBytes: number
  uptimeSeconds: number
  primaryIp: string
  sshPort: number
  user: string
  timezone: string
}

export interface SudoAccess {
  available: boolean
  passwordless: boolean
  reason: string
}

export const IDENTITY_PROBE = 'core.identity'
export const SUDO_PROBE = 'core.sudo'
