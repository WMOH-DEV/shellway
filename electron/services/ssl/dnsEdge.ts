import { promises as dns } from 'node:dns'
import { BlockList, isIPv6 } from 'node:net'
import type { EdgeInfo } from '../../../src/types/ssl'
import { unknownEdge } from './report'

export type AddressResolver = (host: string) => Promise<string[]>

export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32'
]

const MISSING_NAME_CODES = new Set(['ENOTFOUND', 'ENODATA'])
const NO_ADDRESS = 'no DNS address found for this name'

function cloudflareList(): BlockList {
  const list = new BlockList()
  for (const range of CLOUDFLARE_RANGES) {
    const [network, prefix] = range.split('/')
    list.addSubnet(network, Number(prefix), isIPv6(network) ? 'ipv6' : 'ipv4')
  }
  return list
}

const RANGES = cloudflareList()

export function isCloudflareAddress(address: string): boolean {
  return RANGES.check(address, isIPv6(address) ? 'ipv6' : 'ipv4')
}

const LOOKUP_TIMEOUT_MS = 5_000

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error('DNS lookup timed out'), { code: 'ETIMEOUT' })), ms).unref()
  })
}

export async function resolveAddresses(host: string): Promise<string[]> {
  const found = await Promise.race([dns.lookup(host, { all: true }), timeout(LOOKUP_TIMEOUT_MS)])
  return found.map((entry) => entry.address)
}

function lookupFailure(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code ?? ''
  if (MISSING_NAME_CODES.has(code)) return NO_ADDRESS
  return `DNS lookup failed${code ? ` (${code})` : ''}`
}

function resolvedEdge(state: 'elsewhere' | 'not-on-cloudflare', address: string): EdgeInfo {
  return { state, zone: null, recordType: isIPv6(address) ? 'AAAA' : 'A', recordContent: address, sslMode: null, unknownReason: null }
}

function edgeFor(addresses: string[], serverAddresses: string[], reasonWhenOnCloudflare: string): EdgeInfo {
  if (addresses.length === 0) return unknownEdge(NO_ADDRESS)
  if (addresses.some(isCloudflareAddress)) return unknownEdge(reasonWhenOnCloudflare)
  const ours = new Set(serverAddresses.map((a) => a.toLowerCase()))
  if (ours.size > 0 && !addresses.some((a) => ours.has(a.toLowerCase()))) return resolvedEdge('elsewhere', addresses[0])
  return resolvedEdge('not-on-cloudflare', addresses[0])
}

async function lookupEdge(host: string, serverAddresses: string[], reasonWhenOnCloudflare: string, resolve: AddressResolver): Promise<EdgeInfo> {
  try {
    return edgeFor(await resolve(host), serverAddresses, reasonWhenOnCloudflare)
  } catch (err) {
    return unknownEdge(lookupFailure(err))
  }
}

export async function edgesWithoutZone(
  hosts: string[],
  serverAddresses: string[],
  reasonWhenOnCloudflare: string,
  resolve: AddressResolver = resolveAddresses
): Promise<Record<string, EdgeInfo>> {
  const entries = await Promise.all(hosts.map(async (host) => [host, await lookupEdge(host, serverAddresses, reasonWhenOnCloudflare, resolve)] as const))
  return Object.fromEntries(entries)
}
