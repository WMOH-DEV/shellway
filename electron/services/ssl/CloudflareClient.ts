import type { CloudflareStatus, CloudflareZone, EdgeInfo, OriginKeyType, OriginValidityYears, PermissionGroup, PermissionLine, PermissionState, SslMode } from '../../../src/types/ssl'
import { edgesWithoutZone } from './dnsEdge'
import { unknownEdge } from './report'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type TokenCheck = Pick<CloudflareStatus, 'error' | 'permissions' | 'zones'>

export const PERMISSION_LABELS = {
  zone: 'Zone → Zone → Read',
  dns: 'Zone → DNS → Read',
  zoneSettingsRead: 'Zone → Zone Settings → Read',
  sslEdit: 'Zone → SSL and Certificates → Edit',
  zoneSettingsEdit: 'Zone → Zone Settings → Edit'
} as const

export const ZONE_NOT_VISIBLE_REASON = 'zone not visible to the Cloudflare token'

const API_BASE = 'https://api.cloudflare.com/client/v4'
const REQUEST_TIMEOUT_MS = 15_000
const MAX_PAGES = 10
const ZONES_PER_PAGE = 50
const PROBE_PER_PAGE = 5
const RECORDS_PER_PAGE = 100
const VALIDITY_DAYS: Record<OriginValidityYears, number> = { 1: 365, 2: 730, 3: 1095, 15: 5475 }
const REQUEST_TYPES: Record<OriginKeyType, string> = { ecc: 'origin-ecc', rsa: 'origin-rsa' }
const MAX_ORIGIN_HOSTNAMES = 200
const SSL_MODES: readonly string[] = ['off', 'flexible', 'full', 'strict', 'origin_pull']
const SETTABLE_MODES: readonly string[] = ['off', 'flexible', 'full', 'strict']
const ROUTING_RECORD_TYPES = new Set(['A', 'AAAA', 'CNAME'])
const ADDRESS_RECORD_TYPES = new Set(['A', 'AAAA'])

interface ApiEnvelope<T> {
  result?: T
  errors?: { message?: string }[]
  result_info?: { total_pages?: number }
}

interface ApiZone {
  id: string
  name: string
}

interface ApiRecord {
  type: string
  name: string
  content: string
  proxied?: boolean
}

export interface ProxiedRecord {
  type: string
  name: string
  content: string
}

interface ApiOriginCertificate {
  certificate?: string
  expires_on?: string
}

export interface OriginCertificate {
  certificate: string
  notAfter: number | null
}

interface Probes {
  dns: PermissionState
  settings: PermissionState
  certificates: PermissionState
}

const NOT_PROBED: Probes = { dns: 'unknown', settings: 'unknown', certificates: 'unknown' }

class CloudflareApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

const parseSslMode = (value: string | undefined): SslMode | null => (SSL_MODES.includes(value ?? '') ? (value as SslMode) : null)

const isDenied = (err: unknown): boolean => err instanceof CloudflareApiError && err.status === 403

const STOP_STATUSES = new Set([401, 429])
const shouldStop = (err: unknown): boolean => err instanceof CloudflareApiError && STOP_STATUSES.has(err.status)

function failureMessage(status: number, body: ApiEnvelope<unknown>): string {
  if (status === 401) return 'Cloudflare rejected this token. Check that it was copied completely and has not expired or been deleted.'
  if (status === 429) return 'Cloudflare is limiting requests from this token. Try again in a few minutes.'
  if (status >= 500) return `Cloudflare had a problem (error ${status}). Try again later.`
  return `Cloudflare answered: ${body.errors?.[0]?.message ?? `error ${status}`}`
}

function transportError(err: unknown): CloudflareApiError {
  if (err instanceof CloudflareApiError) return err
  const aborted = (err as Error)?.name === 'AbortError'
  const message = aborted ? 'Cloudflare did not answer within 15 seconds.' : 'Could not reach Cloudflare. Check this PC\'s internet connection.'
  return new CloudflareApiError(message, 0)
}

async function readBody<T>(response: Response): Promise<ApiEnvelope<T>> {
  try {
    return (await response.json()) as ApiEnvelope<T>
  } catch {
    return {}
  }
}

function mapProbe(allowed: boolean | null, denied: PermissionState, answered: PermissionState): PermissionState {
  if (allowed === null) return 'unknown'
  return allowed ? answered : denied
}

function permissionLine(label: string, state: PermissionState): PermissionLine {
  return { label, state }
}

function groupState(lines: PermissionLine[]): PermissionState {
  const states = lines.map((line) => line.state)
  if (states.includes('missing')) return 'missing'
  if (states.includes('not-granted')) return 'not-granted'
  return states.every((state) => state === 'granted') ? 'granted' : 'unknown'
}

function permissionGroup(id: PermissionGroup['id'], lines: PermissionLine[]): PermissionGroup {
  return { id, state: groupState(lines), lines }
}

function permissionGroups(zoneRead: PermissionState, probes: Probes): PermissionGroup[] {
  return [
    permissionGroup('monitoring', [
      permissionLine(PERMISSION_LABELS.zone, zoneRead),
      permissionLine(PERMISSION_LABELS.dns, probes.dns),
      permissionLine(PERMISSION_LABELS.zoneSettingsRead, probes.settings)
    ]),
    permissionGroup('origin-ca', [permissionLine(PERMISSION_LABELS.sslEdit, probes.certificates)]),
    permissionGroup('zone-mode', [permissionLine(PERMISSION_LABELS.zoneSettingsEdit, 'unknown')])
  ]
}

function zoneFor(host: string, zonesLongestFirst: CloudflareZone[]): CloudflareZone | undefined {
  const name = host.toLowerCase()
  return zonesLongestFirst.find((zone) => name === zone.name || name.endsWith(`.${zone.name}`))
}

function splitByZone(hosts: string[], zones: CloudflareZone[]): { inZone: Map<CloudflareZone, string[]>; outside: string[] } {
  const longestFirst = [...zones].sort((a, b) => b.name.length - a.name.length)
  const inZone = new Map<CloudflareZone, string[]>()
  const outside: string[] = []
  for (const host of hosts) {
    const zone = zoneFor(host, longestFirst)
    if (!zone) outside.push(host)
    else inZone.set(zone, [...(inZone.get(zone) ?? []), host])
  }
  return { inZone, outside }
}

function edgeFromRecords(zone: string, sslMode: SslMode | null, host: string, found: ApiRecord[], serverAddresses: string[]): EdgeInfo {
  const wanted = host.toLowerCase()
  const records = found.filter((r) => ROUTING_RECORD_TYPES.has(r.type) && r.name.toLowerCase() === wanted)
  if (records.length === 0) return { ...unknownEdge('no DNS record found'), zone, sslMode }
  const ours = new Set(serverAddresses.map((a) => a.toLowerCase()))
  const isAddress = (r: ApiRecord) => ADDRESS_RECORD_TYPES.has(r.type)
  const elsewhere = ours.size > 0 ? records.find((r) => isAddress(r) && !ours.has(r.content.toLowerCase())) : undefined
  const record = elsewhere ?? records.find(isAddress) ?? records[0]
  const state = elsewhere ? 'elsewhere' : record.proxied ? 'proxied' : 'dns-only'
  return { state, zone, recordType: record.type, recordContent: record.content, sslMode, unknownReason: null }
}

function parseExpiry(value: string | undefined): number | null {
  const match = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(value ?? '')
  const millis = match ? Date.parse(`${match[1]}T${match[2]}Z`) : Number.NaN
  return Number.isNaN(millis) ? null : Math.floor(millis / 1000)
}

function originCertificateError(err: unknown): Error {
  if (err instanceof CloudflareApiError && err.status === 403) {
    return new Error('Cloudflare refused to create the certificate. The token needs Zone → SSL and Certificates → Edit for these names.')
  }
  return err as Error
}

function deniedAs(message: string, err: unknown): Error {
  return isDenied(err) ? new Error(message) : (err as Error)
}

function dnsFailure(err: unknown): string {
  if (isDenied(err)) return 'the token cannot read DNS records (it needs Zone → DNS → Read)'
  return (err as Error).message
}

export class CloudflareClient {
  constructor(private readonly token: string, private readonly fetchImpl: FetchLike = fetch) {}

  async check(): Promise<TokenCheck> {
    try {
      return await this.inspectToken()
    } catch (err) {
      return { error: (err as Error).message, permissions: [], zones: [] }
    }
  }

  async edges(hosts: string[], serverAddresses: string[], zones: CloudflareZone[]): Promise<Record<string, EdgeInfo>> {
    const { inZone, outside } = splitByZone(hosts, zones)
    const zoned = await this.zonedEdges(inZone, serverAddresses)
    const unzoned = await edgesWithoutZone(outside, serverAddresses, ZONE_NOT_VISIBLE_REASON)
    return { ...zoned, ...unzoned }
  }

  async createOriginCert(csr: string, hostnames: string[], keyType: OriginKeyType, years: OriginValidityYears): Promise<OriginCertificate> {
    if (hostnames.length === 0 || hostnames.length > MAX_ORIGIN_HOSTNAMES) throw new Error(`An Origin CA certificate needs between 1 and ${MAX_ORIGIN_HOSTNAMES} names`)
    const body = { csr, hostnames, request_type: REQUEST_TYPES[keyType], requested_validity: VALIDITY_DAYS[years] }
    try {
      const reply = await this.request<ApiOriginCertificate>('/certificates', {}, body)
      const certificate = reply.result?.certificate
      if (!certificate?.includes('BEGIN CERTIFICATE')) throw new Error('Cloudflare did not return a certificate.')
      return { certificate, notAfter: parseExpiry(reply.result?.expires_on) }
    } catch (err) {
      throw originCertificateError(err)
    }
  }

  async findZone(name: string): Promise<CloudflareZone> {
    const wanted = name.trim().toLowerCase()
    const zone = (await this.listZones()).find((candidate) => candidate.name === wanted)
    if (!zone) throw new Error(`${name} is not a zone in this Cloudflare account.`)
    return zone
  }

  async currentSslMode(zoneId: string): Promise<SslMode | null> {
    try {
      const body = await this.request<{ value?: string }>(`/zones/${zoneId}/settings/ssl`)
      return parseSslMode(body.result?.value)
    } catch (err) {
      throw deniedAs('The Cloudflare token needs Zone Settings · Read to read the SSL mode.', err)
    }
  }

  async listProxiedRecords(zoneId: string): Promise<ProxiedRecord[]> {
    const records: ProxiedRecord[] = []
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const body = await this.request<ApiRecord[]>(`/zones/${zoneId}/dns_records`, { page, per_page: RECORDS_PER_PAGE })
        const proxied = (body.result ?? []).filter((r) => ROUTING_RECORD_TYPES.has(r.type) && r.proxied === true)
        records.push(...proxied.map((r) => ({ type: r.type, name: r.name.toLowerCase(), content: r.content })))
        if (page >= (body.result_info?.total_pages ?? 1)) break
      }
    } catch (err) {
      throw deniedAs('The Cloudflare token needs DNS · Read to list the zone\'s records.', err)
    }
    return records
  }

  async setSslMode(zoneId: string, mode: SslMode): Promise<void> {
    if (!SETTABLE_MODES.includes(mode)) throw new Error('Cloudflare cannot be set to that SSL mode from here.')
    try {
      await this.request(`/zones/${zoneId}/settings/ssl`, {}, { value: mode }, 'PATCH')
    } catch (err) {
      throw deniedAs('The Cloudflare token needs Zone Settings · Edit to change the SSL mode.', err)
    }
  }

  private async request<T>(path: string, query: Record<string, string | number> = {}, payload?: unknown, method = payload === undefined ? 'GET' : 'POST'): Promise<ApiEnvelope<T>> {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))
    const url = params.size > 0 ? `${API_BASE}${path}?${params}` : `${API_BASE}${path}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal
      })
      const body = await readBody<T>(response)
      if (!response.ok) throw new CloudflareApiError(failureMessage(response.status, body), response.status)
      return body
    } catch (err) {
      throw transportError(err)
    } finally {
      clearTimeout(timer)
    }
  }

  private async allowed(path: string, query: Record<string, string | number>): Promise<boolean | null> {
    try {
      await this.request(path, query)
      return true
    } catch (err) {
      if (err instanceof CloudflareApiError && err.status === 401) throw err
      return isDenied(err) ? false : null
    }
  }

  private async listZones(): Promise<CloudflareZone[]> {
    const zones: CloudflareZone[] = []
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.request<ApiZone[]>('/zones', { page, per_page: ZONES_PER_PAGE })
      zones.push(...(body.result ?? []).map((zone) => ({ id: zone.id, name: zone.name.toLowerCase() })))
      if (page >= (body.result_info?.total_pages ?? 1)) break
    }
    return zones
  }

  private async zonesOrDenied(): Promise<CloudflareZone[] | null> {
    try {
      return await this.listZones()
    } catch (err) {
      if (isDenied(err)) return null
      throw err
    }
  }

  private async probeZone(zone: CloudflareZone): Promise<Probes> {
    const [dns, settings, certificates] = await Promise.all([
      this.allowed(`/zones/${zone.id}/dns_records`, { per_page: PROBE_PER_PAGE }),
      this.allowed(`/zones/${zone.id}/settings/ssl`, {}),
      this.allowed('/certificates', { zone_id: zone.id, per_page: PROBE_PER_PAGE })
    ])
    return {
      dns: mapProbe(dns, 'missing', 'granted'),
      settings: mapProbe(settings, 'missing', 'granted'),
      certificates: mapProbe(certificates, 'not-granted', 'unknown')
    }
  }

  private async inspectToken(): Promise<TokenCheck> {
    const zones = await this.zonesOrDenied()
    const probes = zones?.[0] ? await this.probeZone(zones[0]) : NOT_PROBED
    return { error: null, zones: zones ?? [], permissions: permissionGroups(zones ? 'granted' : 'missing', probes) }
  }

  private async sslMode(zone: CloudflareZone): Promise<SslMode | null> {
    try {
      const body = await this.request<{ value?: string }>(`/zones/${zone.id}/settings/ssl`)
      return parseSslMode(body.result?.value)
    } catch (err) {
      if (shouldStop(err)) throw err
      return null
    }
  }

  private async hostEdge(zone: CloudflareZone, host: string, sslMode: SslMode | null, serverAddresses: string[]): Promise<EdgeInfo> {
    try {
      const body = await this.request<ApiRecord[]>(`/zones/${zone.id}/dns_records`, { name: host, per_page: RECORDS_PER_PAGE })
      return edgeFromRecords(zone.name, sslMode, host, body.result ?? [], serverAddresses)
    } catch (err) {
      if (shouldStop(err)) throw err
      return { ...unknownEdge(dnsFailure(err)), zone: zone.name, sslMode }
    }
  }

  private async zonedEdges(inZone: Map<CloudflareZone, string[]>, serverAddresses: string[]): Promise<Record<string, EdgeInfo>> {
    const edges: Record<string, EdgeInfo> = {}
    for (const [zone, hosts] of inZone) {
      const sslMode = await this.sslMode(zone)
      for (const host of hosts) edges[host] = await this.hostEdge(zone, host, sslMode, serverAddresses)
    }
    return edges
  }
}
