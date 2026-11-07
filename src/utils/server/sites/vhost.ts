import type { VhostServer } from './types'

const FPM_SOCKET = /php(\d+\.\d+)-fpm\.sock/g
const NGINX_SERVER_NAME = /^(\s*server_name\s+)([^;#\n]*?)(\s*;.*)$/
const APACHE_NAME = /^(\s*)(ServerName|ServerAlias)\s+(.+?)\s*$/i
const VHOST_OPEN = /^\s*<VirtualHost\b/i
const VHOST_CLOSE = /^\s*<\/VirtualHost>/i
const LOG_PATH = /^\/var\/log\/(nginx|apache2|httpd)\/[A-Za-z0-9._-]+$/

export function vhostServer(path: string): VhostServer | null {
  if (path.startsWith('/etc/nginx/')) return { kind: 'nginx', layout: null }
  if (path.startsWith('/etc/apache2/')) return { kind: 'apache', layout: 'debian' }
  if (path.startsWith('/etc/httpd/')) return { kind: 'apache', layout: 'rhel' }
  return null
}

export function phpVersionIn(content: string): string | null {
  const versions = [...new Set([...content.matchAll(FPM_SOCKET)].map((m) => m[1]))]
  return versions.length === 1 ? versions[0] : null
}

export function withPhpVersion(content: string, version: string): string {
  if (!/^\d+\.\d+$/.test(version)) throw new Error('Pick a PHP version like 8.3')
  if (phpVersionIn(content) === null) throw new Error('This site file does not point at a single PHP-FPM socket, so Shellway cannot switch it safely.')
  return content.replace(FPM_SOCKET, `php${version}-fpm.sock`)
}

const splitNames = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean)
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const hasName = (names: string[], name: string) => names.some((n) => sameName(n, name))

function editNginxNames(content: string, anchor: string, edit: (names: string[]) => string[]): string {
  let touched = false
  const lines = content.split('\n').map((line) => {
    const match = NGINX_SERVER_NAME.exec(line)
    if (!match || !hasName(splitNames(match[2]), anchor)) return line
    touched = true
    const names = edit(splitNames(match[2]))
    if (names.length === 0) throw new Error('A site needs at least one name.')
    return `${match[1]}${names.join(' ')}${match[3]}`
  })
  if (!touched) throw new Error(`No server_name line lists ${anchor} in this file.`)
  return lines.join('\n')
}

interface ApacheBlock {
  nameLines: number[]
  names: string[]
}

function apacheBlocks(lines: string[]): ApacheBlock[] {
  const blocks: ApacheBlock[] = []
  let current: ApacheBlock | null = null
  lines.forEach((line, index) => {
    if (VHOST_OPEN.test(line)) current = { nameLines: [], names: [] }
    else if (VHOST_CLOSE.test(line) && current) {
      blocks.push(current)
      current = null
    } else if (current) {
      const match = APACHE_NAME.exec(line)
      if (match) {
        current.nameLines.push(index)
        current.names.push(...splitNames(match[3]))
      }
    }
  })
  return blocks
}

function addApacheAlias(content: string, anchor: string, domain: string): string {
  const lines = content.split('\n')
  const targets = apacheBlocks(lines).filter((block) => hasName(block.names, anchor) && !hasName(block.names, domain))
  if (targets.length === 0) throw new Error(`No VirtualHost lists ${anchor} without ${domain} in this file.`)
  for (const block of [...targets].reverse()) {
    const last = block.nameLines[block.nameLines.length - 1]
    const indent = APACHE_NAME.exec(lines[last])?.[1] ?? '    '
    lines.splice(last + 1, 0, `${indent}ServerAlias ${domain}`)
  }
  return lines.join('\n')
}

function removeApacheAlias(content: string, domain: string): string {
  const lines = content.split('\n')
  const drop = new Set<number>()
  let touched = false
  for (const block of apacheBlocks(lines)) {
    for (const index of block.nameLines) {
      const match = APACHE_NAME.exec(lines[index])
      if (!match || !hasName(splitNames(match[3]), domain)) continue
      if (match[2].toLowerCase() === 'servername') throw new Error(`${domain} is the main name of this site. Shellway can only remove extra names.`)
      touched = true
      const rest = splitNames(match[3]).filter((n) => !sameName(n, domain))
      if (rest.length === 0) drop.add(index)
      else lines[index] = `${match[1]}${match[2]} ${rest.join(' ')}`
    }
  }
  if (!touched) throw new Error(`${domain} is not listed in this file.`)
  return lines.filter((_, index) => !drop.has(index)).join('\n')
}

export function addDomain(content: string, server: VhostServer, anchor: string, domain: string): string {
  if (server.kind === 'apache') return addApacheAlias(content, anchor, domain)
  const next = editNginxNames(content, anchor, (names) => (hasName(names, domain) ? names : [...names, domain]))
  if (next === content) throw new Error(`${domain} is already listed for this site.`)
  return next
}

export function removeDomain(content: string, server: VhostServer, domain: string): string {
  if (server.kind === 'apache') return removeApacheAlias(content, domain)
  return editNginxNames(content, domain, (names) => names.filter((n) => !sameName(n, domain)))
}

const LOG_DIRECTIVES: Record<VhostServer['kind'], { error: RegExp; access: RegExp }> = {
  nginx: { error: /^\s*error_log\s+([^\s;]+)/gm, access: /^\s*access_log\s+([^\s;]+)/gm },
  apache: { error: /^\s*ErrorLog\s+"?([^\s"]+)/gim, access: /^\s*CustomLog\s+"?([^\s"]+)/gim }
}

function defaultLogs(server: VhostServer): { error: string; access: string } {
  if (server.kind === 'nginx') return { error: '/var/log/nginx/error.log', access: '/var/log/nginx/access.log' }
  if (server.layout === 'rhel') return { error: '/var/log/httpd/error_log', access: '/var/log/httpd/access_log' }
  return { error: '/var/log/apache2/error.log', access: '/var/log/apache2/access.log' }
}

export const isWebLogPath = (path: string): boolean => LOG_PATH.test(path) && !path.includes('..')

const expandApacheDir = (path: string) => path.replace('${APACHE_LOG_DIR}', '/var/log/apache2')

function firstLog(content: string, pattern: RegExp): string | null {
  const found = [...content.matchAll(pattern)].map((m) => expandApacheDir(m[1]))
  return found.find(isWebLogPath) ?? null
}

export function vhostLogs(content: string, server: VhostServer): { error: string; access: string } {
  const fallback = defaultLogs(server)
  const patterns = LOG_DIRECTIVES[server.kind]
  return {
    error: firstLog(content, patterns.error) ?? fallback.error,
    access: firstLog(content, patterns.access) ?? fallback.access
  }
}
