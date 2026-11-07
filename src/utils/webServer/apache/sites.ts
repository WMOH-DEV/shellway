import type { ServerBlock } from '../../../types/ssl'
import { splitConfigFiles } from '../configDump'
import { type ApacheDirective, findVirtualHost, firstArg, parseApacheConfig, vhostNames, virtualHosts, within } from './config'

export interface DirectoryRule {
  path: string
  options: string[]
  allowOverride: string[]
}

export interface VhostDetail {
  documentRoot: string | null
  directories: DirectoryRule[]
  phpHandler: string | null
  rewriteEngine: boolean
  includes: string[]
}

interface VhostAddress {
  host: string | null
  port: number | null
}

export const MOD_PHP = 'mod_php'

const WILDCARD_HOSTS = new Set(['*', '_default_', '::', '0.0.0.0'])
const VHOST_ADDRESS = /^(?:\[([^\]]*)\]|([^:]+))(?::(\d+|\*))?$/
const PROXY_UNIX_SOCKET = /^proxy:unix:([^|]+)/i
const MOD_PHP_MODULE = /^(?:mod_php|php\d*_module)/i
const PHP_INI_DIRECTIVES = ['php_value', 'php_flag', 'php_admin_value', 'php_admin_flag']

function parseVhostAddress(spec: string): VhostAddress | null {
  const match = VHOST_ADDRESS.exec(spec)
  if (!match) return null
  const host = match[1] ?? match[2]
  const port = match[3] && match[3] !== '*' ? Number(match[3]) : null
  return { host: WILDCARD_HOSTS.has(host) ? null : host, port }
}

const formatAddress = (host: string, port: number): string => `${host.includes(':') ? `[${host}]` : host}:${port}`

function probeAddress(addresses: VhostAddress[], tls: boolean): string {
  const onTlsPort = addresses.filter((a) => a.port === 443)
  const fallback = tls ? addresses.find((a) => a.port !== null) : undefined
  const pick = onTlsPort.find((a) => a.host) ?? onTlsPort[0] ?? fallback
  return formatAddress(pick?.host ?? '127.0.0.1', pick?.port ?? 443)
}

const isOn = (value: string | null) => value?.toLowerCase() === 'on'

function serverBlock(file: string, vhost: ApacheDirective): ServerBlock {
  const addresses = vhost.args.map(parseVhostAddress).filter((a): a is VhostAddress => a !== null)
  const certPath = firstArg(vhost, 'sslcertificatefile') ?? ''
  const tls = certPath !== '' || isOn(firstArg(vhost, 'sslengine')) || addresses.some((a) => a.port === 443)
  return {
    id: `${file}:${vhost.line}`,
    file,
    line: vhost.line,
    names: vhostNames(vhost),
    tls,
    certPath,
    keyPath: firstArg(vhost, 'sslcertificatekeyfile') ?? '',
    probeAddress: probeAddress(addresses, tls),
    root: firstArg(vhost, 'documentroot')
  }
}

export function parseApacheSites(dump: string): ServerBlock[] {
  return splitConfigFiles(dump).flatMap((file) => virtualHosts(parseApacheConfig(file.content)).map((vhost) => serverBlock(file.path, vhost)))
}

const argsOf = (section: ApacheDirective, name: string): string[] => within(section, name).flatMap((d) => d.args)

function directoryRule(directory: ApacheDirective): DirectoryRule {
  return { path: directory.args[0] ?? '', options: argsOf(directory, 'options'), allowOverride: argsOf(directory, 'allowoverride') }
}

function proxySocket(vhost: ApacheDirective): string | null {
  return within(vhost, 'sethandler').map((d) => PROXY_UNIX_SOCKET.exec(d.args[0] ?? '')?.[1]).find(Boolean) ?? null
}

function usesModPhp(vhost: ApacheDirective): boolean {
  const insideModPhp = within(vhost, 'ifmodule').some((s) => MOD_PHP_MODULE.test(s.args[0] ?? ''))
  return insideModPhp || PHP_INI_DIRECTIVES.some((name) => within(vhost, name).length > 0)
}

function phpHandler(vhost: ApacheDirective): string | null {
  return proxySocket(vhost) ?? (usesModPhp(vhost) ? MOD_PHP : null)
}

export function vhostDetail(fileText: string, blockLine: number): VhostDetail {
  const vhost = findVirtualHost(fileText, blockLine)
  return {
    documentRoot: firstArg(vhost, 'documentroot'),
    directories: within(vhost, 'directory').map(directoryRule),
    phpHandler: phpHandler(vhost),
    rewriteEngine: within(vhost, 'rewriteengine').some((d) => isOn(d.args[0] ?? null)),
    includes: [...within(vhost, 'include'), ...within(vhost, 'includeoptional')].sort((a, b) => a.line - b.line).flatMap((d) => d.args)
  }
}
