import type { EdgeInfo, NameReadiness, ReadinessCheck, SslMode } from '../../../../src/types/ssl'
import { isCloudflareAddress } from '../dnsEdge'
import type { AddressResolver } from '../dnsEdge'
import { errorCode, TIMEOUT_CODE } from './httpGet'
import type { HttpGet } from './httpGet'

const PORT80_TIMEOUT_MS = 5_000
const PORT80_PROBE_PATH = '/.well-known/acme-challenge/shellway-check'
const NO_RECORD = 'no DNS record for this name'
const MISSING_NAME_CODES = new Set(['ENOTFOUND', 'ENODATA'])
const SSL_MODE_LABELS: Record<SslMode, string> = {
  off: 'Off',
  flexible: 'Flexible',
  full: 'Full',
  strict: 'Full (strict)',
  origin_pull: 'Origin pull'
}

export type EdgesOf = (names: string[]) => Promise<Record<string, EdgeInfo> | null>

export interface ReadinessDeps {
  serverAddresses: string[]
  resolve: AddressResolver
  httpGet: HttpGet
  edgesOf: EdgesOf
}

interface Lookup {
  addresses: string[]
  failure: ReadinessCheck | null
}

const ok = (detail: string): ReadinessCheck => ({ state: 'ok', detail })
const fail = (detail: string): ReadinessCheck => ({ state: 'fail', detail })
const unknown = (detail: string): ReadinessCheck => ({ state: 'unknown', detail })

async function lookup(name: string, resolve: AddressResolver): Promise<Lookup> {
  try {
    const addresses = await resolve(name)
    return { addresses, failure: addresses.length === 0 ? fail(NO_RECORD) : null }
  } catch (err) {
    const code = errorCode(err)
    return { addresses: [], failure: MISSING_NAME_CODES.has(code) ? fail(NO_RECORD) : unknown(`DNS lookup failed${code ? ` (${code})` : ''}`) }
  }
}

function port80Status(status: number): ReadinessCheck {
  if (status < 500) return ok('answers on port 80')
  if (status >= 520 && status <= 526) return fail(`Cloudflare cannot reach the server on port 80 (${status})`)
  return unknown(`port 80 answered with status ${status}`)
}

function port80Failure(err: unknown): ReadinessCheck {
  const code = errorCode(err)
  if (code === 'ECONNREFUSED') return fail('port 80 refused the connection')
  if (code === TIMEOUT_CODE) return fail('no answer on port 80 within 5 seconds')
  return unknown((err as Error).message)
}

async function checkPort80(name: string, httpGet: HttpGet): Promise<ReadinessCheck> {
  try {
    return port80Status((await httpGet(`http://${name}${PORT80_PROBE_PATH}`, PORT80_TIMEOUT_MS)).status)
  } catch (err) {
    return port80Failure(err)
  }
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

const pointsHere = (addresses: string[], ours: string[]) => addresses.some((a) => ours.some((o) => sameAddress(a, o)))

const isBehindCloudflare = (addresses: string[]) => addresses.every(isCloudflareAddress)

function elsewhereDns(addresses: string[], ours: string[]): ReadinessCheck {
  if (ours.length === 0) return unknown('could not tell which addresses belong to this server')
  return fail(`points to ${addresses.find((a) => !isCloudflareAddress(a)) ?? addresses[0]}, not this server`)
}

function cloudflareDns(edge: EdgeInfo | undefined): ReadinessCheck {
  if (edge === undefined) return unknown('behind Cloudflare; add a Cloudflare token to confirm it points here')
  if (edge.zone === null || edge.state === 'unknown') return unknown(`behind Cloudflare; could not confirm where it points (${edge.unknownReason ?? 'no record found'})`)
  if (edge.recordType !== 'A' && edge.recordType !== 'AAAA') return unknown(`behind Cloudflare; the record is a ${edge.recordType} to ${edge.recordContent}, so Shellway cannot tell where it points`)
  if (edge.state === 'elsewhere') return fail(`points to ${edge.recordContent}, not this server`)
  return ok('proxied by Cloudflare, record points to this server')
}

function cloudflareNote(edge: EdgeInfo | undefined): string | null {
  if (edge?.state !== 'proxied' || edge.sslMode === null) return null
  return `Cloudflare SSL mode: ${SSL_MODE_LABELS[edge.sslMode]}`
}

interface Probed extends Lookup {
  name: string
  port80: ReadinessCheck
}

async function probe(name: string, deps: ReadinessDeps): Promise<Probed> {
  const [found, port80] = await Promise.all([lookup(name, deps.resolve), checkPort80(name, deps.httpGet)])
  return { name, ...found, port80 }
}

function namesToConfirm(probed: Probed[], ours: string[]): string[] {
  return probed
    .filter((p) => p.failure === null && !pointsHere(p.addresses, ours) && isBehindCloudflare(p.addresses))
    .map((p) => p.name)
}

function dnsCheck(found: Lookup, ours: string[], edge: EdgeInfo | undefined): ReadinessCheck {
  if (found.failure) return found.failure
  if (pointsHere(found.addresses, ours)) return ok('points to this server')
  return isBehindCloudflare(found.addresses) ? cloudflareDns(edge) : elsewhereDns(found.addresses, ours)
}

export async function checkReadiness(names: string[], deps: ReadinessDeps): Promise<NameReadiness[]> {
  const probed = await Promise.all(names.map((name) => probe(name, deps)))
  const cloudflareNames = namesToConfirm(probed, deps.serverAddresses)
  const edges = cloudflareNames.length > 0 ? ((await deps.edgesOf(cloudflareNames)) ?? {}) : {}
  return probed.map((p) => ({
    name: p.name,
    dns: dnsCheck(p, deps.serverAddresses, edges[p.name]),
    port80: p.port80,
    cloudflare: cloudflareNote(edges[p.name])
  }))
}
