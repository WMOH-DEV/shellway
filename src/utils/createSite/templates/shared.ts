import type { CreateSiteInput, SiteServer } from '@/types/createSite'
import { assertDomain, assertFolder, assertPhpVersion, assertPort, assertSiteName } from '../validate'

export interface SiteVars {
  siteName: string
  names: string[]
  release: string
}

export function siteNames({ domain, includeWww }: Pick<CreateSiteInput, 'domain' | 'includeWww'>): string[] {
  const names = includeWww ? [domain, `www.${domain}`] : [domain]
  return names.map(assertDomain)
}

export function siteVars(input: CreateSiteInput): SiteVars {
  return {
    siteName: assertSiteName(input.siteName),
    names: siteNames(input),
    release: assertFolder(input.folder)
  }
}

export function phpFpmSocket({ server, phpVersion }: Pick<CreateSiteInput, 'server' | 'phpVersion'>): string {
  if (server.kind === 'apache' && server.layout === 'rhel') return '/run/php-fpm/www.sock'
  return `/run/php/php${assertPhpVersion(phpVersion)}-fpm.sock`
}

export const appUpstream = ({ appPort }: Pick<CreateSiteInput, 'appPort'>): string => `http://127.0.0.1:${assertPort(appPort)}`

export function apacheLogDir(server: SiteServer): string {
  if (server.kind !== 'apache') throw new Error('Apache templates need an Apache server')
  return server.layout === 'debian' ? '${APACHE_LOG_DIR}' : 'logs'
}

export const indent = (line: string): string => `    ${line}`

export const fileText = (rows: string[]): string => `${rows.join('\n')}\n`
