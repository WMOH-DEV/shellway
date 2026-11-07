const IPV4_OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const IPV4 = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`)
const IPV6 = /^(?=.*:.*:)[0-9a-fA-F:]{2,39}$/

export const isIpv4 = (value: string): boolean => IPV4.test(value)
export const isIpv6 = (value: string): boolean => IPV6.test(value) && !value.includes(':::')

export function isIpOrCidr(value: string): boolean {
  const [address, prefix, extra] = value.split('/')
  if (extra !== undefined || !address) return false
  const max = isIpv4(address) ? 32 : isIpv6(address) ? 128 : -1
  if (max < 0) return false
  if (prefix === undefined) return true
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= max
}

export function assertIp(value: unknown, label = 'IP address'): string {
  if (typeof value !== 'string' || !isIpOrCidr(value.trim())) throw new Error(`Invalid ${label}`)
  return value.trim()
}

export function assertPort(value: unknown, label = 'port'): number {
  const port = typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : value
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid ${label}`)
  return port
}

export function assertOneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`Invalid ${label}`)
  return value as T
}

export function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid ${label}`)
  return value
}

export function asRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid parameters')
  return raw as Record<string, unknown>
}

const USER = /^[a-z_][a-z0-9_.-]{0,31}\$?$/

export function assertUser(value: unknown): string {
  if (typeof value !== 'string' || !USER.test(value)) throw new Error('Invalid user name')
  return value
}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0)
}

export function ipMatches(ip: string, entry: string): boolean {
  if (ip === entry) return true
  const [network, prefix] = entry.split('/')
  if (!isIpv4(ip) || !isIpv4(network ?? '') || prefix === undefined) return false
  const bits = Number(prefix)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const size = 2 ** (32 - bits)
  return Math.floor(ipv4ToNumber(ip) / size) === Math.floor(ipv4ToNumber(network) / size)
}
