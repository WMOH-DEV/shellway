import type { ApacheLayout, EditableWebServer } from '../../../types/ssl'

export interface SiteVhost {
  path: string
  realPath: string
  sha256: string
  content: string
}

export interface DeploySiteRef {
  name: string
  path: string
  owner: string
}

export interface SitesInventory {
  user: string
  fpmVersions: string[]
  sites: DeploySiteRef[]
  vhosts: SiteVhost[]
}

export interface VhostServer {
  kind: EditableWebServer
  layout: ApacheLayout | null
}

export type SiteStack = 'laravel' | 'php' | 'node' | 'docker' | 'static'

export type SiteLogSource = 'app' | 'error' | 'access'

export interface SiteLogRequest {
  site: string
  source: SiteLogSource
  file: string
  lines: number
}

export type SiteLogResult =
  | { state: 'ok'; text: string }
  | { state: 'missing' }
  | { state: 'unknown-site' }
  | { state: 'no-permission' }
