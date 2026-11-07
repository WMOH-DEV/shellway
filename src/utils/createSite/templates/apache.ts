import type { CreateSiteInput, TemplateId } from '@/types/createSite'
import { apacheLogDir, appUpstream, fileText, indent, phpFpmSocket, siteVars } from './shared'

function virtualHost(input: CreateSiteInput, body: string[]): string {
  const { siteName, names } = siteVars(input)
  const logDir = apacheLogDir(input.server)
  return fileText([
    '<VirtualHost *:80>',
    indent(`ServerName ${names[0]}`),
    ...names.slice(1).map((alias) => indent(`ServerAlias ${alias}`)),
    ...body.map(indent),
    indent(`ErrorLog ${logDir}/${siteName}-error.log`),
    indent(`CustomLog ${logDir}/${siteName}-access.log combined`),
    '</VirtualHost>'
  ])
}

const directory = (root: string, allowOverride: 'All' | 'None'): string[] => [
  `DocumentRoot ${root}`,
  `<Directory ${root}>`,
  indent('Options FollowSymLinks'),
  indent(`AllowOverride ${allowOverride}`),
  indent('Require all granted'),
  '</Directory>'
]

const phpHandler = (input: CreateSiteInput): string[] => [
  '<FilesMatch \\.php$>',
  indent(`SetHandler "proxy:unix:${phpFpmSocket(input)}|fcgi://localhost"`),
  '</FilesMatch>'
]

const laravel = (input: CreateSiteInput): string =>
  virtualHost(input, [...directory(`${siteVars(input).release}/public`, 'All'), ...phpHandler(input)])

const php = (input: CreateSiteInput): string => virtualHost(input, [...directory(siteVars(input).release, 'All'), ...phpHandler(input)])

const staticSite = (input: CreateSiteInput): string => virtualHost(input, directory(siteVars(input).release, 'None'))

function reverseProxy(input: CreateSiteInput): string {
  const upstream = appUpstream(input)
  return virtualHost(input, [
    'ProxyPreserveHost On',
    'ProxyPass /.well-known/acme-challenge/ !',
    `ProxyPass / ${upstream}/`,
    `ProxyPassReverse / ${upstream}/`
  ])
}

export const APACHE_TEMPLATES: Record<TemplateId, (input: CreateSiteInput) => string> = {
  laravel,
  php,
  static: staticSite,
  blank: staticSite,
  node: reverseProxy,
  compose: reverseProxy
}
