import { isIssuableName } from '../ssl/https/issueCommands'

const SITE_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/
const FOLDER = /^(?:\/[A-Za-z0-9_][A-Za-z0-9._-]{0,63}){1,16}$/
const PHP_VERSION = /^\d\.\d{1,2}$/
const OWNER = /^[a-z_][a-z0-9_.-]{0,31}$/
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const HEALTH_PATH = /^\/[A-Za-z0-9._~/-]{0,200}$/
const MODULE = /^[a-z0-9_]{1,40}$/
const CONF = /^[a-z0-9][a-z0-9._-]{0,63}$/
const LINEAGE = /^[a-z0-9][a-z0-9.-]{0,252}$/
const SHA256 = /^[0-9a-f]{64}$/

const matching = (isValid: (value: string) => boolean, what: string) => (value: string): string => {
  if (!isValid(value)) throw new Error(`${JSON.stringify(value)} is not ${what}`)
  return value
}

const pattern = (regex: RegExp) => (value: string): boolean => regex.test(value)

export const assertDomain = matching(isIssuableName, 'a valid domain name')
export const assertSiteName = matching(pattern(SITE_NAME), 'a valid site name')
export const assertFolder = matching(pattern(FOLDER), 'a valid folder')
export const assertPhpVersion = matching(pattern(PHP_VERSION), 'a PHP version')
export const assertOwner = matching(pattern(OWNER), 'a valid user name')
export const assertIpv4 = matching(pattern(IPV4), 'an IPv4 address')
export const assertHealthPath = matching(pattern(HEALTH_PATH), 'a valid health path')
export const assertModule = matching(pattern(MODULE), 'a valid Apache module')
export const assertConf = matching(pattern(CONF), 'a valid Apache conf')
export const assertLineage = matching(pattern(LINEAGE), 'a valid certificate name')
export const assertSha256 = matching(pattern(SHA256), 'a sha256 checksum')

export function assertPort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${port} is not a valid port`)
  return port
}
