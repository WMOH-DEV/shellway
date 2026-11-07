import { assertPhpVersion } from '@/utils/createSite/validate'
import { NGINX_KEYS, type NginxKey } from './nginx'
import { INI_KEYS, POOL_KEYS, type IniKey, type PoolKey } from './php'

export { assertPhpVersion }

export function asRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Expected an object')
  return raw as Record<string, unknown>
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new Error(`${String(value)} is not a valid ${what}`)
  return value as T
}

export function matching(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`${JSON.stringify(value)} is not a valid ${what}`)
  return value
}

export function stringList(value: unknown, check: (item: string) => string, max = 200): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) throw new Error('Expected a non-empty list')
  return [...new Set(value.map((item) => check(String(item))))]
}

export const EXTENSION = /^[a-z0-9][a-z0-9-]{0,40}$/

export const SERVICE_UNIT = /^[A-Za-z0-9@._-]{1,120}\.service$/

const SIZE = /^\d{1,6}[KMG]?$/

const INI_VALUE: Record<IniKey, RegExp> = {
  memory_limit: /^(-1|\d{1,6}[KMG]?)$/,
  upload_max_filesize: SIZE,
  post_max_size: SIZE,
  max_execution_time: /^\d{1,6}$/,
  max_input_vars: /^\d{1,7}$/,
  'date.timezone': /^(UTC|[A-Z][A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2})$/,
  'opcache.enable': /^[01]$/,
  'opcache.memory_consumption': /^\d{1,5}$/
}

const POOL_VALUE: Record<PoolKey, RegExp> = {
  pm: /^(static|dynamic|ondemand)$/,
  'pm.max_children': /^[1-9]\d{0,4}$/,
  'pm.start_servers': /^[1-9]\d{0,4}$/,
  'pm.min_spare_servers': /^[1-9]\d{0,4}$/,
  'pm.max_spare_servers': /^[1-9]\d{0,4}$/,
  'pm.max_requests': /^\d{1,7}$/
}

const NGINX_VALUE: Record<NginxKey, RegExp> = {
  client_max_body_size: /^\d{1,6}[kKmMgG]?$/,
  keepalive_timeout: /^\d{1,4}s?$/,
  gzip: /^(on|off)$/,
  server_tokens: /^(on|off)$/
}

function settings<K extends string>(raw: unknown, keys: readonly K[], patterns: Record<K, RegExp>): Partial<Record<K, string>> {
  const values = asRecord(raw)
  const entries = Object.entries(values).map(([key, value]) => {
    const name = oneOf(key, keys, 'setting')
    return [name, matching(typeof value === 'number' ? String(value) : value, patterns[name], `value for ${name}`)] as const
  })
  if (entries.length === 0) throw new Error('Nothing to change')
  return Object.fromEntries(entries) as Partial<Record<K, string>>
}

export const iniSettings = (raw: unknown): Partial<Record<IniKey, string>> => settings(raw, INI_KEYS, INI_VALUE)

export const poolSettings = (raw: unknown): Partial<Record<PoolKey, string>> => settings(raw, POOL_KEYS, POOL_VALUE)

export const nginxSettings = (raw: unknown): Partial<Record<NginxKey, string>> => settings(raw, NGINX_KEYS, NGINX_VALUE)

export const isValidNginxValue = (key: NginxKey, value: string): boolean => NGINX_VALUE[key].test(value)

export const isValidIniValue = (key: IniKey, value: string): boolean => INI_VALUE[key].test(value)

export const isValidPoolValue = (key: PoolKey, value: string): boolean => POOL_VALUE[key].test(value)

export function poolProblem(pool: Record<string, string>): string | null {
  if (pool.pm !== 'dynamic') return null
  const [children, start, min, max] = ['pm.max_children', 'pm.start_servers', 'pm.min_spare_servers', 'pm.max_spare_servers'].map((key) => Number(pool[key]))
  if ([children, start, min, max].some((value) => !Number.isFinite(value))) return null
  if (min > max) return 'Min spare servers must not be more than max spare servers.'
  if (max > children) return 'Max spare servers must not be more than max children.'
  if (start < min || start > max) return 'Start servers must be between min and max spare servers.'
  return null
}
