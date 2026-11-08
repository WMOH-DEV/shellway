import type { CreateSiteInput, ServerTools, SiteServer } from '@/types/createSite'
import { apacheDriver } from '../webServer/apache'
import { defaultCommands } from './deploySite'
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

function commandsOrNone(input: Omit<CreateSiteInput, 'buildSteps' | 'activateSteps'>): Pick<CreateSiteInput, 'buildSteps' | 'activateSteps'> {
  try {
    return defaultCommands(input)
  } catch {
    return { buildSteps: [], activateSteps: [] }
  }
}

export function baseInput(overrides: Partial<CreateSiteInput> = {}): CreateSiteInput {
  const input: Omit<CreateSiteInput, 'buildSteps' | 'activateSteps'> & Partial<CreateSiteInput> = {
    domain: 'shop.example.com',
    includeWww: true,
    siteName: 'shop',
    folder: '/var/www/shop',
    owner: 'deploy',
    template: 'laravel',
    server: { kind: 'nginx' },
    phpVersion: '8.3',
    appPort: 3000,
    repoUrl: 'git@github.com:acme/shop.git',
    branch: 'main',
    sourceMode: 'auto',
    pollMinutes: 2,
    dns: { zoneId: 'zone-1', zoneName: 'example.com', serverIp: '203.0.113.10', proxied: true },
    https: { email: 'admin@example.com', redirect: true, staging: true },
    healthPath: '/',
    ...overrides
  }
  return { ...commandsOrNone(input), ...input }
}

export const allTools = (overrides: Partial<ServerTools> = {}): ServerTools => ({
  php: { installed: ['8.3'], installable: [], missingPackages: { '8.3': [] } },
  composer: true,
  node: '20',
  pm2: true,
  pm2Startup: true,
  docker: true,
  apacheModules: ['rewrite', 'proxy_fcgi', 'setenvif', 'proxy', 'proxy_http', 'headers', 'ssl'],
  freeDiskBytes: 40e9,
  ...overrides
})
