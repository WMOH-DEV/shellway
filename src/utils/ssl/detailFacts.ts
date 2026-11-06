import type { HostnameStatus, ServerBlock } from '../../types/ssl'
import { certView } from './hostRow'
import { issuerLabel } from './diagram'
import { formatDay } from './time'
import type { Tone } from './tone'

export interface ValidRange {
  from: string
  to: string
  tone: Tone
}

export interface DetailFacts {
  servedBy: { file: string; line: number } | null
  issuer: string
  names: string[]
  valid: ValidRange | null
  lineage: string | null
  certPath: string
  keyPath: string
}

export function validRange(host: HostnameStatus, now: number): ValidRange | null {
  const { origin } = host
  if (!origin || origin.notAfter === null) return null
  return {
    from: origin.notBefore === null ? '' : formatDay(origin.notBefore),
    to: formatDay(origin.notAfter, true),
    tone: certView(host, now).tone
  }
}

export function detailFacts(host: HostnameStatus, block: ServerBlock | undefined, now: number): DetailFacts {
  const { origin } = host
  return {
    servedBy: block ? { file: block.file, line: block.line } : null,
    issuer: origin && origin.kind !== 'none' ? issuerLabel(origin) : '',
    names: origin?.names ?? [],
    valid: validRange(host, now),
    lineage: host.lineage,
    certPath: block?.certPath ?? '',
    keyPath: block?.keyPath ?? ''
  }
}
