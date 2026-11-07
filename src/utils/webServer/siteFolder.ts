import type { ApacheLayout, NginxParse, ServingWebServer } from '../../types/ssl'
import type { VhostDetail } from './apache/sites'

export interface WebServerSite {
  file: string
  names: string[]
  detail: VhostDetail
}

export interface WebServerCheck {
  server: ServingWebServer | null
  layout: ApacheLayout | null
  read: NginxParse
  sites: WebServerSite[]
  rewriteModule: boolean | null
}

export const trimSlash = (path: string): string => path.replace(/\/+$/, '') || '/'

export const isInside = (path: string, folder: string): boolean => {
  const inner = trimSlash(path)
  const outer = trimSlash(folder)
  return inner === outer || inner.startsWith(outer === '/' ? '/' : `${outer}/`)
}
