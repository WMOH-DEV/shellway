import type { ActionStep } from '@/types/server/core'
import type { OsInfo } from '@/types/server/identity'

export type ComponentId =
  | 'nginx'
  | 'apache'
  | 'php'
  | 'composer'
  | 'mysql'
  | 'mariadb'
  | 'postgresql'
  | 'redis'
  | 'node'
  | 'pm2'
  | 'supervisor'
  | 'certbot'
  | 'docker'
  | 'ufw'
  | 'fail2ban'
  | 'unattended-upgrades'

export interface InstallRequest {
  component: ComponentId
  version?: string
  extras?: string[]
}

export type InstallRecipe = { supported: true; steps: ActionStep[]; source: string } | { supported: false; reason: string }

export type RecipeBuilder = (request: InstallRequest, os: OsInfo) => InstallRecipe
