import type { CreateSiteInput, ServerTools, SiteServer } from '@/types/createSite'
import { apacheDriver } from '../webServer/apache'
import { defaultCommands } from './deploySite'
import { writesEnv } from './env'
import type { WebServerDriver } from '../webServer/driver'
import { nginxDriver } from '../webServer/nginx'

export interface ServerCase {
  name: string
  server: SiteServer
  driver: WebServerDriver
}

export const NGINX: ServerCase = { name: 'nginx', server: { kind: 'nginx' }, driver: nginxDriver }
export const APACHE_DEBIAN: ServerCase = {
  name: 'apache debian',
  server: { kind: 'apache', layout: 'debian' },
  driver: apacheDriver('debian')
}
export const APACHE_RHEL: ServerCase = {
  name: 'apache rhel',
  server: { kind: 'apache', layout: 'rhel' },
  driver: apacheDriver('rhel')
}
export const SERVER_CASES: ServerCase[] = [NGINX, APACHE_DEBIAN, APACHE_RHEL]

function commandsOrNone(input: Omit<CreateSiteInput, 'buildSteps' | 'activateSteps' | 'database' | 'env'>): Pick<CreateSiteInput, 'buildSteps' | 'activateSteps'> {
  try {
    return defaultCommands(input)
  } catch {
    return { buildSteps: [], activateSteps: [] }
  }
}

function envOrNone(facts: Parameters<typeof writesEnv>[0]): boolean {
  try {
    return writesEnv(facts, '')
  } catch {
    return false
  }
}

export function baseInput(overrides: Partial<CreateSiteInput> = {}): CreateSiteInput {
  const input: Omit<CreateSiteInput, 'buildSteps' | 'activateSteps' | 'database' | 'env'> & Partial<CreateSiteInput> = {
    domain: 'shop.example.com',
    includeWww: true,
    siteName: 'shop',
    folder: '/var/www/shop',
    owner: 'deploy',
    template: 'laravel',
    server: { kind: 'nginx' },
    phpVersion: '8.3',
    appPort: 3000,
    buildOutput: null,
    spa: false,
    repoUrl: 'git@github.com:acme/shop.git',
    branch: 'main',
    sourceMode: 'auto',
    pollMinutes: 2,
    dns: { zoneId: 'zone-1', zoneName: 'example.com', serverIp: '203.0.113.10', proxied: true },
    https: { email: 'admin@example.com', redirect: true, staging: true },
    healthPath: '/',
    jobs: { scheduler: false, queueWorker: false },
    ...overrides
  }
  const usesDatabase = input.template === 'laravel' || input.template === 'php'
  const database = input.database !== undefined ? input.database : usesDatabase ? { engine: 'mysql' as const, name: 'shop', user: 'shop' } : null
  const stackDefaults = { database, env: envOrNone({ ...input, database }) }
  return { ...commandsOrNone(input), ...stackDefaults, ...input }
}

export const allTools = (overrides: Partial<ServerTools> = {}): ServerTools => ({
  php: { installed: ['8.3'], installable: [], missingPackages: { '8.3': [] }, drivers: { '8.3': ['mysql', 'sqlite3'] } },
  composer: true,
  node: '20',
  pm2: true,
  pm2Startup: true,
  docker: true,
  databases: { mysql: true, postgresql: false },
  systemd: true,
  cron: true,
  apacheModules: ['rewrite', 'proxy_fcgi', 'setenvif', 'proxy', 'proxy_http', 'headers', 'ssl'],
  freeDiskBytes: 40e9,
  ...overrides
})
