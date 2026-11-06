import type { ServerBlock } from '../../../types/ssl'

export interface SiteRef {
  path: string
  healthUrl: string
}

const trimSlashes = (path: string): string => (path.length > 1 ? path.replace(/\/+$/, '') : path)

function isUnder(root: string, sitePath: string): boolean {
  const base = trimSlashes(sitePath)
  const dir = trimSlashes(root)
  return base !== '' && (dir === base || dir.startsWith(`${base}/`))
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function blocksNamed(host: string, blocks: ServerBlock[]): ServerBlock[] {
  const wanted = host.trim().toLowerCase()
  if (wanted === '') return []
  return blocks.filter((block) => block.names.some((name) => name.toLowerCase() === wanted))
}

export const blockForHostname = (host: string, blocks: ServerBlock[]): ServerBlock | null => blocksNamed(host, blocks)[0] ?? null

export function blockForSite(site: SiteRef, blocks: ServerBlock[]): ServerBlock | null {
  const byRoot = blocks.filter((block) => block.root !== null && isUnder(block.root, site.path))
  const candidates = byRoot.length > 0 ? byRoot : blocksNamed(hostOf(site.healthUrl), blocks)
  return candidates.find((block) => block.tls) ?? candidates[0] ?? null
}
