import type { CertbotLineage, CloudflareStatus, EdgeInfo, HostnameStatus, OriginCert, ServerBlock, ServerScan, SslReport } from '../../../src/types/ssl'
import { certCovers, daysLeft, VERDICT_ORDER, verdictFor } from '../../../src/utils/ssl/verdict'

const NO_CERTIFICATE: OriginCert = { kind: 'none', subject: '', issuer: '', names: [], notBefore: null, notAfter: null, error: null }

export function unknownEdge(reason: string): EdgeInfo {
  return { state: 'unknown', zone: null, recordType: null, recordContent: null, sslMode: null, unknownReason: reason }
}

export function unknownEdges(hosts: string[], reason: string): Record<string, EdgeInfo> {
  return Object.fromEntries(hosts.map((host) => [host, unknownEdge(reason)]))
}

export const isPattern = (name: string): boolean => name.includes('*') || name.startsWith('~') || name.startsWith('.')

export function hostnamesOf(blocks: ServerBlock[]): string[] {
  return [...new Set(blocks.flatMap((b) => b.names).filter((n) => n && n !== '_'))]
}

function servingBlocks(blocks: ServerBlock[]): Map<string, ServerBlock> {
  const byName = new Map<string, ServerBlock>()
  for (const block of blocks) {
    for (const name of block.names) {
      if (!name || name === '_') continue
      const current = byName.get(name)
      if (!current || (!current.tls && block.tls)) byName.set(name, block)
    }
  }
  return byName
}

function lineageFor(lineages: CertbotLineage[], block: ServerBlock, name: string): CertbotLineage | undefined {
  return lineages.find((l) => block.certPath !== '' && l.certPath === block.certPath)
    ?? lineages.find((l) => certCovers(l.domains, name))
}

function originFor(scan: ServerScan, block: ServerBlock, name: string): OriginCert | null {
  if (isPattern(name)) return null
  if (!block.tls) return NO_CERTIFICATE
  return scan.origins[name] ?? null
}

function hostnameStatus(scan: ServerScan, block: ServerBlock, name: string, edge: EdgeInfo, now: number): HostnameStatus {
  const origin = originFor(scan, block, name)
  const lineage = lineageFor(scan.lineages, block, name)
  const { renewal } = scan.facts
  const result = verdictFor({
    host: name,
    origin,
    edge,
    certbotManaged: lineage !== undefined && origin?.kind === 'letsencrypt',
    renewalHealthy: renewal.mechanism !== 'none' && renewal.lastResult !== 'failed',
    now
  })
  const wildcard = isPattern(name)
  return {
    name,
    blockId: block.id,
    wildcard,
    origin,
    lineage: lineage?.name ?? null,
    edge,
    ...result,
    reason: wildcard && result.uncheckedSide === 'server' ? 'Wildcard name, not checked' : result.reason
  }
}

function severity(host: HostnameStatus, now: number): [number, number] {
  const days = host.origin?.notAfter != null ? daysLeft(host.origin.notAfter, now) : Number.POSITIVE_INFINITY
  return [VERDICT_ORDER.indexOf(host.verdict), days]
}

function compareHosts(now: number) {
  return (a: HostnameStatus, b: HostnameStatus): number => {
    const [va, da] = severity(a, now)
    const [vb, db] = severity(b, now)
    return va - vb || da - db || a.name.localeCompare(b.name)
  }
}

export function buildReport(scan: ServerScan, edges: Record<string, EdgeInfo>, cloudflare: CloudflareStatus, now: number): SslReport {
  const fallback = unknownEdge(cloudflare.saved ? 'zone not visible to the token' : 'no Cloudflare token')
  const hostnames = [...servingBlocks(scan.blocks)]
    .map(([name, block]) => hostnameStatus(scan, block, name, edges[name] ?? fallback, now))
    .sort(compareHosts(now))
  return { checkedAt: now, facts: scan.facts, blocks: scan.blocks, lineages: scan.lineages, hostnames, cloudflare }
}
