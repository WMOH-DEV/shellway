import type { SslMode, ZoneHostProbe, ZoneModeResult, ZonePreflight } from '../../../../src/types/ssl'
import type { CloudflareClient, ProxiedRecord } from '../CloudflareClient'
import { probeOrigin, type OriginProbe, type ProbeOutcome } from './probeOrigin'

const PROBE_CONCURRENCY = 6
const ROLLBACK_MODES: readonly SslMode[] = ['full', 'flexible', 'off']
const WILDCARD_DETAIL = "a wildcard record can't be tested as one hostname"

export type ZoneModeClient = Pick<CloudflareClient, 'findZone' | 'currentSslMode' | 'listProxiedRecords' | 'setSslMode'>

export interface ZoneModeDeps {
  client: ZoneModeClient
  probe?: OriginProbe
}

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
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

async function probeRecord(record: ProxiedRecord, probe: OriginProbe): Promise<ZoneHostProbe> {
  const outcome: ProbeOutcome = record.name.includes('*')
    ? { state: 'unknown', detail: WILDCARD_DETAIL }
    : await probe({ name: record.name, recordType: record.type, origin: record.content })
  return { name: record.name, recordType: record.type, origin: record.content, ...outcome }
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
  const hosts = await mapLimit(uniqueRecords(records), PROBE_CONCURRENCY, (record) => probeRecord(record, probe))
  return { zoneId: zone.id, zone: zone.name, currentMode, hosts, blockedReason: blockedReason(currentMode, hosts) }
}

async function setStrict(zoneName: string, confirmedUnknown: string[], deps: ZoneModeDeps): Promise<ZoneModeResult> {
  const preflight = await preflightZone(zoneName, deps)
  const refusal = preflight.blockedReason ?? unconfirmedReason(preflight.hosts, confirmedUnknown)
  if (refusal) throw new Error(refusal)
  await deps.client.setSslMode(preflight.zoneId, 'strict')
  return { zone: preflight.zone, previousMode: preflight.currentMode, mode: 'strict' }
}

async function setRollback(zoneName: string, mode: SslMode, { client }: ZoneModeDeps): Promise<ZoneModeResult> {
  const zone = await client.findZone(zoneName)
  const previousMode = await client.currentSslMode(zone.id)
  await client.setSslMode(zone.id, mode)
  return { zone: zone.name, previousMode, mode }
}

export function setZoneMode(zoneName: string, mode: SslMode, confirmedUnknown: string[], deps: ZoneModeDeps): Promise<ZoneModeResult> {
  if (mode === 'strict') return setStrict(zoneName, confirmedUnknown, deps)
  if (!ROLLBACK_MODES.includes(mode)) return Promise.reject(new Error('That SSL mode cannot be set from here.'))
  return setRollback(zoneName, mode, deps)
}
