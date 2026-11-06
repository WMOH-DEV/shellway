import type { CloudflareZone, HostnameStatus } from '../../types/ssl'

export const ZONE_NOT_VISIBLE_REASON = 'zone not visible to the Cloudflare token'

export interface ZoneCoverage {
  zone: CloudflareZone
  hostnames: number
}

const plainNames = (hostnames: HostnameStatus[]): HostnameStatus[] => hostnames.filter((h) => !h.wildcard)

export function zoneCoverage(zones: CloudflareZone[], hostnames: HostnameStatus[]): ZoneCoverage[] {
  const namesByZone = new Map<string, Set<string>>()
  for (const { name, edge } of plainNames(hostnames)) {
    if (edge.zone) namesByZone.set(edge.zone, (namesByZone.get(edge.zone) ?? new Set()).add(name))
  }
  return zones.map((zone) => ({ zone, hostnames: namesByZone.get(zone.name)?.size ?? 0 }))
}

export function hostnamesOutsideZones(hostnames: HostnameStatus[]): string[] {
  const names = plainNames(hostnames)
    .filter((h) => h.edge.unknownReason === ZONE_NOT_VISIBLE_REASON)
    .map((h) => h.name)
  return [...new Set(names)].sort()
}

export function hostnameCount(count: number): string {
  return `${count} ${count === 1 ? 'hostname' : 'hostnames'}`
}

export function outsideZonesWarning(names: string[]): string | null {
  if (names.length === 0) return null
  const subject = names.length === 1 ? `${names[0]} is not in a zone` : `${names.join(', ')} are not in a zone`
  return `${subject} this token can see. Add ${names.length === 1 ? 'its zone' : 'their zones'} to the token to check the Cloudflare side.`
}
