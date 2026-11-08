import type { CreateSiteInput, SiteServer } from '@/types/createSite'
import { poolLayout } from '../phpPool'
import { assertBuildOutput, assertDomain, assertFolder, assertPort, assertSiteName } from '../validate'

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

export function staticRoot(input: Pick<CreateSiteInput, 'folder' | 'buildOutput'>): string {
  const release = assertFolder(input.folder)
  return input.buildOutput === null ? release : `${release}/${assertBuildOutput(input.buildOutput)}`
}

export const phpFpmSocket = (input: Pick<CreateSiteInput, 'server' | 'phpVersion' | 'siteName'>): string => poolLayout(input).socket

export const appUpstream = ({ appPort }: Pick<CreateSiteInput, 'appPort'>): string => `http://127.0.0.1:${assertPort(appPort)}`

export function apacheLogDir(server: SiteServer): string {
  if (server.kind !== 'apache') throw new Error('Apache templates need an Apache server')
  return server.layout === 'debian' ? '${APACHE_LOG_DIR}' : 'logs'
}

export const indent = (line: string): string => `    ${line}`

export const fileText = (rows: string[]): string => `${rows.join('\n')}\n`
