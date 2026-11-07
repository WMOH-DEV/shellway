import { LINEAGE_NAME } from '../../ssl/commands'
import { isIssuableName } from '../../ssl/https/issueCommands'

const SITE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
const VHOST_PATH = /^\/etc\/(nginx|apache2|httpd)\/[A-Za-z0-9._/-]+$/
const PHP_VERSION = /^\d+\.\d{1,2}$/
const MAX_NAMES = 100

export interface CertificateRef {
  lineage: string
  names: string[]
}

export function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid request')
  return raw as Record<string, unknown>
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} is missing`)
  return value
}

export function siteName(value: unknown): string {
  const name = asString(value, 'Site')
  if (!SITE_NAME.test(name)) throw new Error('Invalid site name')
  return name
}

export function vhostPath(value: unknown): string {
  const path = asString(value, 'Site file')
  if (!VHOST_PATH.test(path) || path.includes('..')) throw new Error('Invalid site file path')
  return path
}

export function domainName(value: unknown): string {
  const name = asString(value, 'Domain').trim().toLowerCase()
  if (!isIssuableName(name)) throw new Error(`${name || 'That'} is not a valid domain name`)
  return name
}

export function phpVersion(value: unknown): string {
  const version = asString(value, 'PHP version')
  if (!PHP_VERSION.test(version)) throw new Error('Invalid PHP version')
  return version
}

export function certificateRef(value: unknown): CertificateRef | null {
  if (value === null || value === undefined) return null
  const raw = asRecord(value)
  const lineage = asString(raw.lineage, 'Certificate')
  if (!LINEAGE_NAME.test(lineage)) throw new Error('Invalid certificate name')
  if (!Array.isArray(raw.names) || raw.names.length === 0 || raw.names.length > MAX_NAMES) throw new Error('Invalid certificate names')
  return { lineage, names: raw.names.map(domainName) }
}
