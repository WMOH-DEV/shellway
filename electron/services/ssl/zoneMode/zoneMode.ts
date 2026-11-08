import type { SslMode, ZoneHostProbe, ZoneModeResult, ZonePreflight } from '../../../../src/types/ssl'
import type { CloudflareClient, ProxiedRecord } from '../CloudflareClient'
import { probeOrigin, type OriginProbe, type ProbeOutcome } from './probeOrigin'

const PROBE_CONCURRENCY = 6
const PREFLIGHT_DEADLINE_MS = 90_000
const MAX_PROBED_RECORDS = 300
const MAX_CNAME_DEPTH = 5
const ROLLBACK_MODES: readonly SslMode[] = ['full', 'flexible', 'off']
const WILDCARD_DETAIL = "a wildcard record can't be tested as one hostname"
const NOT_CHECKED_DETAIL = 'not checked in time'
const ROLLBACK_REFUSAL = 'Shellway only sets a zone back to the mode it had before Shellway changed it.'

export type ZoneModeClient = Pick<CloudflareClient, 'findZone' | 'currentSslMode' | 'listProxiedRecords' | 'setSslMode'>

export interface ZoneChange {
  previousMode: SslMode | null
}

export interface ZoneModeDeps {
  client: ZoneModeClient
  changes: Map<string, ZoneChange>
  probe?: OriginProbe
}

interface PlannedHost {
  name: string
  recordType: string
  origin: string
  outcome?: ProbeOutcome
}

async function mapLimit<T, R>(items: T[], limit: number, timeoutMs: number, work: (item: T) => Promise<R>, fallback: (item: T) => R): Promise<R[]> {
  const results = new Array<R | undefined>(items.length)
  let next = 0
  let expired = false
  const worker = async () => {
    while (!expired && next < items.length) {
      const index = next++
      const result = await work(items[index])
      if (!expired) results[index] = result
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true
      resolve()
    }, timeoutMs)
  })
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  try {
    await Promise.race([Promise.all(workers), deadline])
  } finally {
    clearTimeout(timer)
  }
  return items.map((item, index) => results[index] ?? fallback(item))
}

function uniqueRecords(records: ProxiedRecord[]): ProxiedRecord[] {
  const seen = new Set<string>()
  return records.filter((record) => {
    const key = `${record.name}|${record.content.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const normalizeName = (name: string): string => name.toLowerCase().replace(/\.$/, '')

const isInZone = (name: string, zoneName: string): boolean => name === zoneName || name.endsWith(`.${zoneName}`)

function indexByName(records: ProxiedRecord[]): Map<string, ProxiedRecord[]> {
  const index = new Map<string, ProxiedRecord[]>()
  for (const record of records) index.set(record.name, [...(index.get(record.name) ?? []), record])
  return index
}

const unresolved = (record: ProxiedRecord, detail: string): PlannedHost[] => [
  { name: record.name, recordType: record.type, origin: record.content, outcome: { state: 'unknown', detail } }
]

function planCname(record: ProxiedRecord, index: Map<string, ProxiedRecord[]>, zoneName: string): PlannedHost[] {
  const visited = new Set([record.name])
  let target = normalizeName(record.content)
  for (let depth = 0; depth < MAX_CNAME_DEPTH; depth++) {
    const hops = index.get(target)
    if (!hops) {
      if (!isInZone(target, zoneName)) return unresolved(record, `points to ${target}, check that origin yourself`)
      return [{ name: record.name, recordType: record.type, origin: target }]
    }
    if (visited.has(target)) return unresolved(record, `its CNAME chain loops back to ${target}`)
    visited.add(target)
    const addresses = hops.filter((hop) => hop.type !== 'CNAME')
    if (addresses.length > 0) return addresses.map((hop) => ({ name: record.name, recordType: record.type, origin: hop.content }))
    target = normalizeName(hops[0].content)
  }
  return unresolved(record, `its CNAME chain is longer than ${MAX_CNAME_DEPTH} hops`)
}

function planRecord(record: ProxiedRecord, index: Map<string, ProxiedRecord[]>, zoneName: string): PlannedHost[] {
  if (record.name.includes('*')) return unresolved(record, WILDCARD_DETAIL)
  if (record.type === 'CNAME') return planCname(record, index, zoneName)
  return [{ name: record.name, recordType: record.type, origin: record.content }]
}

const withOutcome = (host: PlannedHost, outcome: ProbeOutcome): ZoneHostProbe => ({ name: host.name, recordType: host.recordType, origin: host.origin, ...outcome })

const unprobed = (host: PlannedHost): ZoneHostProbe => withOutcome(host, host.outcome ?? { state: 'unknown', detail: NOT_CHECKED_DETAIL })

async function probeAll(records: ProxiedRecord[], zoneName: string, probe: OriginProbe): Promise<ZoneHostProbe[]> {
  const index = indexByName(records)
  const planned = uniqueRecords(records).flatMap((record) => planRecord(record, index, zoneName))
  const withinCap = new Set(planned.filter((host) => !host.outcome).slice(0, MAX_PROBED_RECORDS))
  const probeHost = async (host: PlannedHost) =>
    host.outcome || !withinCap.has(host) ? unprobed(host) : withOutcome(host, await probe({ name: host.name, recordType: host.recordType, origin: host.origin }))
  return mapLimit(planned, PROBE_CONCURRENCY, PREFLIGHT_DEADLINE_MS, probeHost, unprobed)
}

function namesIn(hosts: ZoneHostProbe[], state: ZoneHostProbe['state']): string[] {
  return [...new Set(hosts.filter((host) => host.state === state).map((host) => host.name))]
}

function blockedReason(currentMode: SslMode | null, hosts: ZoneHostProbe[]): string | null {
  if (currentMode === 'strict') return 'This zone is already set to Full (strict).'
  const failing = namesIn(hosts, 'fail')
  return failing.length > 0 ? `These hostnames would break with Full (strict): ${failing.join(', ')}` : null
}

function unconfirmedReason(hosts: ZoneHostProbe[], confirmed: string[]): string | null {
  const accepted = new Set(confirmed.map((name) => name.toLowerCase()))
  const missing = namesIn(hosts, 'unknown').filter((name) => !accepted.has(name))
  return missing.length > 0 ? `These hostnames could not be checked from this computer and need your confirmation: ${missing.join(', ')}` : null
}

export async function preflightZone(zoneName: string, { client, probe = probeOrigin }: ZoneModeDeps): Promise<ZonePreflight> {
  const zone = await client.findZone(zoneName)
  const [currentMode, records] = await Promise.all([client.currentSslMode(zone.id), client.listProxiedRecords(zone.id)])
  const hosts = await probeAll(records, zone.name, probe)
  return { zoneId: zone.id, zone: zone.name, currentMode, hosts, blockedReason: blockedReason(currentMode, hosts) }
}

async function setStrict(zoneName: string, confirmedUnknown: string[], deps: ZoneModeDeps): Promise<ZoneModeResult> {
  const preflight = await preflightZone(zoneName, deps)
  const refusal = preflight.blockedReason ?? unconfirmedReason(preflight.hosts, confirmedUnknown)
  if (refusal) throw new Error(refusal)
  await deps.client.setSslMode(preflight.zoneId, 'strict')
  deps.changes.set(preflight.zoneId, { previousMode: preflight.currentMode })
  return { zone: preflight.zone, previousMode: preflight.currentMode, mode: 'strict' }
}

async function setRollback(zoneName: string, mode: SslMode, { client, changes }: ZoneModeDeps): Promise<ZoneModeResult> {
  const zone = await client.findZone(zoneName)
  const previousMode = await client.currentSslMode(zone.id)
  if (previousMode !== 'strict' || changes.get(zone.id)?.previousMode !== mode) throw new Error(ROLLBACK_REFUSAL)
  await client.setSslMode(zone.id, mode)
  changes.delete(zone.id)
  return { zone: zone.name, previousMode, mode }
}

export function setZoneMode(zoneName: string, mode: SslMode, confirmedUnknown: string[], deps: ZoneModeDeps): Promise<ZoneModeResult> {
  if (mode === 'strict') return setStrict(zoneName, confirmedUnknown, deps)
  if (!ROLLBACK_MODES.includes(mode)) return Promise.reject(new Error('That SSL mode cannot be set from here.'))
  return setRollback(zoneName, mode, deps)
}
