import type { HostnameStatus, ServerBlock, SslReport, SwitchCheck, SwitchName } from '../../../types/ssl'

function nameCheck(name: string, host: HostnameStatus | undefined): SwitchName {
  if (name.includes('*') || name.startsWith('~')) return { name, ok: false, reason: 'wildcard and pattern names are not supported' }
  if (!host) return { name, ok: false, reason: 'not checked yet' }
  if (host.edge.state !== 'proxied') return { name, ok: false, reason: host.edge.state === 'unknown' ? (host.edge.unknownReason ?? 'Cloudflare status unknown') : 'not proxied by Cloudflare' }
  if (!host.edge.zone) return { name, ok: false, reason: 'zone not visible to the token' }
  return { name, ok: true, reason: null }
}

function blockedReason(report: SslReport, block: ServerBlock, names: SwitchName[], hosts: HostnameStatus[]): string | null {
  if (!block.tls || !block.certPath) return 'This site has no HTTPS server block to switch.'
  if (!report.cloudflare.saved) return 'Add a Cloudflare token first.'
  const permission = report.cloudflare.permissions.find((group) => group.id === 'origin-ca')
  if (!permission || permission.state === 'missing' || permission.state === 'not-granted') return 'The Cloudflare token needs SSL and Certificates · Edit.'
  if (!report.facts.sudo.full) return 'Needs full passwordless sudo on this server.'
  if (hosts.length > 0 && hosts.every((host) => host.origin?.kind === 'cloudflare-origin')) return 'This site already uses a Cloudflare Origin CA certificate.'
  const broken = names.filter((name) => !name.ok).map((name) => name.name)
  return broken.length > 0 ? `These names would break: ${broken.join(', ')}` : null
}

export function switchCheck(report: SslReport, blockId: string): SwitchCheck {
  const block = report.blocks.find((b) => b.id === blockId)
  if (!block) return { blockId, names: [], blockedReason: 'This site is no longer in the nginx configuration.' }
  const byName = new Map(report.hostnames.filter((host) => host.blockId === blockId).map((host) => [host.name.toLowerCase(), host]))
  const names = block.names.map((name) => nameCheck(name, byName.get(name.toLowerCase())))
  return { blockId, names, blockedReason: blockedReason(report, block, names, [...byName.values()]) }
}
