import type { CreateSiteInput, TemplateId } from '@/types/createSite'
import { appUpstream, fileText, indent, phpFpmSocket, siteVars } from './shared'

const DENY_DOTFILES = 'location ~ /\\.(?!well-known) { deny all; }'
const SERVE_FILES = 'location / { try_files $uri $uri/ =404; }'

function serverBlock(names: string[], body: string[]): string {
  return fileText(['server {', indent('listen 80;'), indent(`server_name ${names.join(' ')};`), ...body.map(indent), '}'])
}

const phpLocation = (input: CreateSiteInput): string =>
  `location ~ \\.php$ { fastcgi_pass unix:${phpFpmSocket(input)}; include snippets/fastcgi-php.conf; }`

function laravel(input: CreateSiteInput): string {
  const { names, release } = siteVars(input)
  return serverBlock(names, [
    `root ${release}/public;`,
    'index index.php;',
    'location / { try_files $uri $uri/ /index.php?$query_string; }',
    phpLocation(input),
    DENY_DOTFILES
  ])
}

function php(input: CreateSiteInput): string {
  const { names, release } = siteVars(input)
  return serverBlock(names, [`root ${release};`, 'index index.php index.html;', SERVE_FILES, phpLocation(input), DENY_DOTFILES])
}

function staticSite(input: CreateSiteInput): string {
  const { names, release } = siteVars(input)
  return serverBlock(names, [`root ${release};`, 'index index.html;', SERVE_FILES, DENY_DOTFILES])
}

function reverseProxy(input: CreateSiteInput): string {
  const { names } = siteVars(input)
  return serverBlock(names, [
    'location / {',
    indent(`proxy_pass ${appUpstream(input)};`),
    indent('proxy_http_version 1.1;'),
    indent('proxy_set_header Upgrade $http_upgrade;'),
    indent('proxy_set_header Connection "upgrade";'),
    indent('proxy_set_header Host $host;'),
    indent('proxy_set_header X-Real-IP $remote_addr;'),
    indent('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;'),
    indent('proxy_set_header X-Forwarded-Proto $scheme;'),
    '}'
  ])
}

export const NGINX_TEMPLATES: Record<TemplateId, (input: CreateSiteInput) => string> = {
  laravel,
  php,
  static: staticSite,
  blank: staticSite,
  node: reverseProxy,
  compose: reverseProxy
}
