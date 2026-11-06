import type { EdgeInfo, HostnameStatus, SslMode, ZoneHostProbe, ZonePreflight, ZoneProbeState } from '../../../types/ssl'

const MODE_LABELS: Record<SslMode, string> = {
  off: 'Off',
  flexible: 'Flexible',
  full: 'Full',
  strict: 'Full (strict)',
  origin_pull: 'Strict (origin pull)'
}

export const STRICT_LABEL = MODE_LABELS.strict

export const modeLabel = (mode: SslMode | null): string => (mode ? MODE_LABELS[mode] : 'Unknown')

export const strictOfferZone = (edge: EdgeInfo): string | null =>
  edge.state === 'proxied' && edge.zone && edge.sslMode !== 'strict' ? edge.zone : null

export function zoneSslMode(zone: string, hostnames: HostnameStatus[]): SslMode | null {
  return hostnames.find((h) => h.edge.zone === zone && h.edge.sslMode !== null)?.edge.sslMode ?? null
}

export const offersStrict = (mode: SslMode | null): boolean => mode !== 'strict'

export type ProbeTone = 'success' | 'error' | 'warning'

export interface ProbeView {
  tone: ProbeTone
  text: string
}

const PROBE_LABELS: Record<ZoneProbeState, { tone: ProbeTone; label: string }> = {
  pass: { tone: 'success', label: 'Passes' },
  fail: { tone: 'error', label: 'Would break' },
  unknown: { tone: 'warning', label: "Couldn't check" }
}

export function probeView({ state, detail }: ZoneHostProbe): ProbeView {
  const { tone, label } = PROBE_LABELS[state]
  return { tone, text: state !== 'pass' && detail ? `${label}: ${detail}` : label }
}

const SEVERITY: Record<ZoneProbeState, number> = { fail: 0, unknown: 1, pass: 2 }

export const sortedProbes = (hosts: ZoneHostProbe[]): ZoneHostProbe[] =>
  [...hosts].sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state])

const namesIn = (hosts: ZoneHostProbe[], state: ZoneProbeState): string[] =>
  [...new Set(hosts.filter((h) => h.state === state).map((h) => h.name))]

export const failedNames = (preflight: ZonePreflight): string[] => namesIn(preflight.hosts, 'fail')

export const unknownNames = (preflight: ZonePreflight): string[] => namesIn(preflight.hosts, 'unknown')

export function canApplyStrict(preflight: ZonePreflight, confirmedUnknown: boolean): boolean {
  if (preflight.blockedReason !== null || failedNames(preflight).length > 0) return false
  return unknownNames(preflight).length === 0 || confirmedUnknown
}

export const confirmedNames = (preflight: ZonePreflight, confirmedUnknown: boolean): string[] =>
  confirmedUnknown ? unknownNames(preflight) : []

export function blockedMessage(preflight: ZonePreflight): string | null {
  if (preflight.blockedReason) return preflight.blockedReason
  const names = failedNames(preflight)
  if (names.length === 0) return null
  const [subject, owner] = names.length === 1 ? ['this hostname', 'its'] : ['these hostnames', 'their']
  return `Full (strict) would break ${subject}: ${names.join(', ')}. Fix ${owner} origin certificate first.`
}

const REVERTABLE_MODES: readonly SslMode[] = ['off', 'flexible', 'full']

export const revertableMode = (previous: SslMode | null): SslMode | null =>
  previous && REVERTABLE_MODES.includes(previous) ? previous : null
